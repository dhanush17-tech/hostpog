/**
 * Native identity resolution.
 *
 * Postgres holds the authoritative distinct_id -> person mapping (transactional,
 * advisory-locked per project). Every change is mirrored to ClickHouse with a
 * monotonically increasing version so queries resolve persons at read time:
 * a later merge retroactively re-attributes earlier anonymous events.
 *
 * Merge rules (aligned with PostHog's documented behaviour):
 *  - identify(user, anon): anon's person is merged into user's person only if
 *    the anon person was never identified. Two identified persons never merge.
 *  - alias(a, b) behaves like identify for the purposes of this module.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { nativePersonDistinctIds, nativePersons, type Db } from "@hostpog/db";

export interface IdentityChange {
  distinctId: string;
  personId: string;
}

export interface PersonPropsChange {
  personId: string;
  properties: Record<string, unknown>;
}

export interface IdentityResult {
  personId: string;
  mappingChanges: IdentityChange[];
  propsChanges: PersonPropsChange[];
  warnings: string[];
}

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

async function lock(tx: Tx, projectId: string) {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${"hostpog-identity:" + projectId}))`);
}

async function personFor(tx: Tx, projectId: string, distinctId: string): Promise<string | null> {
  const rows = await tx
    .select({ personId: nativePersonDistinctIds.personId })
    .from(nativePersonDistinctIds)
    .where(and(eq(nativePersonDistinctIds.partitionId, projectId), eq(nativePersonDistinctIds.distinctId, distinctId)))
    .limit(1);
  return rows[0]?.personId ?? null;
}

function applyProps(
  current: Record<string, unknown>,
  set: Record<string, unknown> | undefined,
  setOnce: Record<string, unknown> | undefined,
): { next: Record<string, unknown>; changed: boolean } {
  const next = { ...current };
  let changed = false;
  for (const [k, v] of Object.entries(setOnce ?? {})) {
    if (!(k in next)) {
      next[k] = v;
      changed = true;
    }
  }
  for (const [k, v] of Object.entries(set ?? {})) {
    if (JSON.stringify(next[k]) !== JSON.stringify(v)) {
      next[k] = v;
      changed = true;
    }
  }
  return { next, changed };
}

export interface ResolveInput {
  projectId: string;
  distinctId: string;
  /** set for $identify / $create_alias */
  anonDistinctId?: string;
  identify?: boolean;
  set?: Record<string, unknown>;
  setOnce?: Record<string, unknown>;
  /** event timestamp: persons are "created" at their earliest event, not at ingest time */
  seenAt?: Date;
}

/**
 * Create persons for many brand-new anonymous distinct ids in one locked transaction (instead of one per event).
 * Ids that turn out to exist already (another writer got there first) are returned with created=false.
 */
export async function createAnonymousPersons(
  db: Db,
  projectId: string,
  items: { distinctId: string; seenAt: Date; setOnce?: Record<string, unknown> }[],
): Promise<{ distinctId: string; personId: string; created: boolean; properties: Record<string, unknown> }[]> {
  if (!items.length) return [];
  return db.transaction(async (tx) => {
    await lock(tx, projectId);
    const ids = items.map((i) => i.distinctId);
    const existing = new Map<string, string>();
    for (let i = 0; i < ids.length; i += 1000) {
      const rows = await tx
        .select({ d: nativePersonDistinctIds.distinctId, p: nativePersonDistinctIds.personId })
        .from(nativePersonDistinctIds)
        .where(and(eq(nativePersonDistinctIds.partitionId, projectId), inArray(nativePersonDistinctIds.distinctId, ids.slice(i, i + 1000))));
      for (const r of rows) existing.set(r.d, r.p);
    }
    const fresh = items.filter((i) => !existing.has(i.distinctId));
    const out: { distinctId: string; personId: string; created: boolean; properties: Record<string, unknown> }[] = [];
    for (const [d, p] of existing) out.push({ distinctId: d, personId: p, created: false, properties: {} });
    for (let i = 0; i < fresh.length; i += 500) {
      const chunk = fresh.slice(i, i + 500);
      const persons = await tx
        .insert(nativePersons)
        .values(chunk.map((c) => ({ partitionId: projectId, isIdentified: false, properties: c.setOnce ?? {}, createdAt: c.seenAt })))
        .returning({ id: nativePersons.id });
      await tx.insert(nativePersonDistinctIds).values(chunk.map((c, j) => ({ partitionId: projectId, distinctId: c.distinctId, personId: persons[j]!.id })));
      chunk.forEach((c, j) => out.push({ distinctId: c.distinctId, personId: persons[j]!.id, created: true, properties: c.setOnce ?? {} }));
    }
    return out;
  });
}

/** Which of these distinct ids already map to a person in this partition (one query). */
export async function knownDistinctIds(db: Db, projectId: string, distinctIds: string[]): Promise<string[]> {
  const out: string[] = [];
  for (let i = 0; i < distinctIds.length; i += 1000) {
    const rows = await db
      .select({ d: nativePersonDistinctIds.distinctId })
      .from(nativePersonDistinctIds)
      .where(and(eq(nativePersonDistinctIds.partitionId, projectId), inArray(nativePersonDistinctIds.distinctId, distinctIds.slice(i, i + 1000))));
    out.push(...rows.map((r) => r.d));
  }
  return out;
}

export async function resolveIdentity(db: Db, input: ResolveInput): Promise<IdentityResult> {
  return db.transaction(async (tx) => {
    await lock(tx, input.projectId);
    const warnings: string[] = [];
    const mappingChanges: IdentityChange[] = [];
    const propsChanges: PersonPropsChange[] = [];
    const { projectId } = input;

    const seenAt = input.seenAt ?? new Date();
    const createPerson = async (identified: boolean) => {
      const [p] = await tx
        .insert(nativePersons)
        .values({ partitionId: projectId, isIdentified: identified, properties: {}, createdAt: seenAt })
        .returning({ id: nativePersons.id });
      return p!.id;
    };
    const map = async (distinctId: string, personId: string) => {
      await tx
        .insert(nativePersonDistinctIds)
        .values({ partitionId: projectId, distinctId, personId })
        .onConflictDoUpdate({
          target: [nativePersonDistinctIds.partitionId, nativePersonDistinctIds.distinctId],
          set: { personId },
        });
      mappingChanges.push({ distinctId, personId });
    };

    let personId = await personFor(tx, projectId, input.distinctId);
    const anon = input.anonDistinctId && input.anonDistinctId !== input.distinctId ? input.anonDistinctId : undefined;

    if (anon) {
      const anonPerson = await personFor(tx, projectId, anon);
      const anonRow = anonPerson ? (await tx.select().from(nativePersons).where(eq(nativePersons.id, anonPerson)).limit(1))[0] : undefined;
      if (!personId && !anonPerson) {
        personId = await createPerson(true);
        await map(input.distinctId, personId);
        await map(anon, personId);
      } else if (personId && !anonPerson) {
        await map(anon, personId);
      } else if (!personId && anonPerson) {
        if (anonRow?.isIdentified) {
          warnings.push(`anonymous id already belongs to an identified person; created a separate person for ${input.distinctId}`);
          personId = await createPerson(true);
          await map(input.distinctId, personId);
        } else {
          personId = anonPerson;
          await map(input.distinctId, personId);
        }
      } else if (personId && anonPerson && personId !== anonPerson) {
        if (anonRow?.isIdentified) {
          warnings.push("refusing to merge two identified persons");
        } else {
          // move every distinct id of the anonymous person onto the identified person
          const moved = await tx
            .select({ distinctId: nativePersonDistinctIds.distinctId })
            .from(nativePersonDistinctIds)
            .where(and(eq(nativePersonDistinctIds.partitionId, projectId), eq(nativePersonDistinctIds.personId, anonPerson)));
          for (const m of moved) await map(m.distinctId, personId);
          const target = (await tx.select().from(nativePersons).where(eq(nativePersons.id, personId)).limit(1))[0];
          // anon props fill gaps only (set_once semantics)
          const merged = applyProps(target?.properties ?? {}, undefined, anonRow?.properties ?? {});
          if (merged.changed) {
            await tx.update(nativePersons).set({ properties: merged.next, updatedAt: new Date() }).where(eq(nativePersons.id, personId));
            propsChanges.push({ personId, properties: merged.next });
          }
          // the merged person existed since the earlier of the two
          if (anonRow && target && anonRow.createdAt < target.createdAt) {
            await tx.update(nativePersons).set({ createdAt: anonRow.createdAt }).where(eq(nativePersons.id, personId));
          }
          await tx.delete(nativePersons).where(eq(nativePersons.id, anonPerson));
        }
      }
    } else if (!personId) {
      personId = await createPerson(Boolean(input.identify));
      await map(input.distinctId, personId);
    }

    const row = (await tx.select().from(nativePersons).where(eq(nativePersons.id, personId!)).limit(1))[0];
    const patch: Partial<typeof nativePersons.$inferInsert> = {};
    if (input.identify && row && !row.isIdentified) patch.isIdentified = true;
    if (row && seenAt < row.createdAt) patch.createdAt = seenAt; // late-arriving earlier event
    const props = applyProps(row?.properties ?? {}, input.set, input.setOnce);
    if (props.changed) patch.properties = props.next;
    if (Object.keys(patch).length) {
      await tx
        .update(nativePersons)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(nativePersons.id, personId!));
    }
    if (props.changed) propsChanges.push({ personId: personId!, properties: props.next });

    return { personId: personId!, mappingChanges, propsChanges, warnings };
  });
}

export async function distinctIdsFor(db: Db, projectId: string, personIds: string[]) {
  if (!personIds.length) return new Map<string, string[]>();
  const rows = await db
    .select()
    .from(nativePersonDistinctIds)
    .where(and(eq(nativePersonDistinctIds.partitionId, projectId), inArray(nativePersonDistinctIds.personId, personIds)));
  const out = new Map<string, string[]>();
  for (const r of rows) out.set(r.personId, [...(out.get(r.personId) ?? []), r.distinctId]);
  return out;
}

export interface ImportedPersonInput {
  partitionId: string;
  distinctIds: string[];
  properties: Record<string, unknown>;
  isIdentified: boolean;
  createdAt: Date | null;
}

/**
 * Import a person profile from another system (e.g. PostHog) keeping its distinct-id
 * grouping. Unmapped ids join the person that already owns any of its ids (live events
 * may have arrived first); otherwise a new person is created. Existing properties win
 * (imported values only fill gaps), so live updates are never overwritten by history.
 */
export async function importPerson(db: Db, input: ImportedPersonInput): Promise<IdentityResult & { created: boolean }> {
  const ids = [...new Set(input.distinctIds.filter(Boolean))].slice(0, 500);
  if (!ids.length) return { personId: "", mappingChanges: [], propsChanges: [], warnings: ["person has no distinct ids; skipped"], created: false };
  return db.transaction(async (tx) => {
    await lock(tx, input.partitionId);
    const existing = await tx
      .select()
      .from(nativePersonDistinctIds)
      .where(and(eq(nativePersonDistinctIds.partitionId, input.partitionId), inArray(nativePersonDistinctIds.distinctId, ids)));
    const owners = [...new Set(existing.map((e) => e.personId))];
    const warnings: string[] = [];
    if (owners.length > 1) warnings.push(`distinct ids already belong to ${owners.length} different persons; attached the rest to the first`);
    let personId = owners[0];
    let created = false;
    if (!personId) {
      const [p] = await tx
        .insert(nativePersons)
        .values({ partitionId: input.partitionId, isIdentified: input.isIdentified, properties: input.properties, createdAt: input.createdAt ?? new Date() })
        .returning({ id: nativePersons.id });
      personId = p!.id;
      created = true;
    }
    const mappingChanges: IdentityChange[] = [];
    for (const id of ids) {
      if (existing.some((e) => e.distinctId === id)) continue;
      await tx.insert(nativePersonDistinctIds).values({ partitionId: input.partitionId, distinctId: id, personId }).onConflictDoNothing();
      mappingChanges.push({ distinctId: id, personId });
    }
    const propsChanges: PersonPropsChange[] = [];
    if (created) {
      propsChanges.push({ personId, properties: input.properties });
    } else {
      const [row] = await tx.select().from(nativePersons).where(eq(nativePersons.id, personId)).limit(1);
      const merged = applyProps(row?.properties ?? {}, undefined, input.properties);
      const patch: Partial<typeof nativePersons.$inferInsert> = {};
      if (merged.changed) patch.properties = merged.next;
      if (input.isIdentified && row && !row.isIdentified) patch.isIdentified = true;
      if (input.createdAt && row && input.createdAt < row.createdAt) patch.createdAt = input.createdAt;
      if (Object.keys(patch).length)
        await tx
          .update(nativePersons)
          .set({ ...patch, updatedAt: new Date() })
          .where(eq(nativePersons.id, personId));
      if (merged.changed) propsChanges.push({ personId, properties: merged.next });
    }
    return { personId, mappingChanges, propsChanges, warnings, created };
  });
}
