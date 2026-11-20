import { closeClickHouse, migrateClickHouse } from "./clickhouse";

const applied = await migrateClickHouse();
console.log(`clickhouse migrations applied: ${applied.join(", ")}`);
await closeClickHouse();
