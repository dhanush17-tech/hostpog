# Onboarding UX Guide for the Build Agent

Source: ASU CSE 463 *Intro to Human-Computer Interaction* (Fall 2026, Dr. Robert K. Atkinson), textbook *Foundations of Human-Computer Interaction: Designing for Cognitive Alignment*. Covers Modules 1–11 (syllabus through Lecture 11b, Assignments 1–3, Final Project). Modules 13–15 had no lecture material available. Tags like [L3] cite the course file (key at the end). Items marked **[General practice]** are not from the course.

Keep this whole file in context while you design, build or review any onboarding screen, flow, email or notification. Examples use a self-hosted product-analytics SaaS (connect a data source → see first chart → ask a question → invite the team); swap in your own product's nouns.

---

## Part A — Rules (read these first)

### A1. What "good" means here
1. **Optimize for cognitive alignment, not engagement.** Users must be able to *understand → act → anticipate → recover → continue* across sessions, not just finish once [L1, L2]. Alignment is relational: it depends on the person, their task, the context and time.
2. **Success = users come back because the product reliably advances their goal**, not because leaving feels costly. Support the full cycle: *engage → sustain → resolve → release → recover → return* [L8].
3. The course rejects "hooked" as a target: "Engagement cannot be the only successful state" [L8]; "Higher engagement can coexist with weaker motivational autonomy" [L11]; "The strongest motivational interface is … the one that makes continued engagement increasingly possible without requiring the interface to keep producing it" [L11]. Build *enjoyment through competence and real outcomes*, not through compulsion.
4. **Log every design decision** as: *Diagnosis → Requirement → Decision → Expected effect → Tradeoff* [SYL, A3].
5. Usability (effectiveness, efficiency, learnability, errors, satisfaction [L1]; ISO 9241-11 [M10A]) is necessary but not sufficient.

### A2. Goal and flow
6. Before building, write each persona's goal and a **hierarchical task analysis** (HTA). Delete steps, re-entry and memory demands that the interface itself creates [L9].
7. Reach **first real value early** (a real chart from the user's own data, an answered question). Defer optional setup [L4, L11].
8. Every requested input gets a **purpose cue**: "Add your PostHog key so we can show your last 30 days of signups" beats "Complete step 2" [L11].
9. **Recommend** a next step, but allow skip, defer and alternatives. **Autosave everything** [L11].
10. Show progress as **remaining distance**: "Setup 2 of 3 — one step left" [L11].
11. **Taper support**: guided → selective (only on struggle or after a long gap) → on demand. Experienced users never see first-run prompts [L11].

### A3. Perception, attention, memory
12. Group fields by the **user's concepts** (Data source · Project · Team), not system internals. Visual grouping must match function [L5, L6].
13. **Destructive or irreversible actions must look different** from routine ones; never put Delete next to Edit in the same style [L5].
14. Primary actions need unmistakable **signifiers** and immediate, specific **feedback**. "Poor action signaling converts interaction into diagnosis" [L5].
15. **Recognition over recall**: keep prior choices, comparisons and state visible. Show a **review summary before any commitment** [L6, M9b].
16. Follow familiar **scripts** (sign up → connect data → see results → act). Explicitly explain anything that breaks the script (who can see what; what "Connect" reads; what a button sends) [L6].
17. Never reuse a familiar icon with a different meaning. Never move or relabel learned controls without signaling the change and keeping the old path [L1, L6].

### A4. Feedback, closure, state
18. **Latency anchors** [L9]: acknowledge every action within ~200 ms; show **determinate** progress after ~1 s ("Importing 3 of 5 tables, ~10 s left"); keep context visible for anything near 10 s.
19. **Close every consequential action** with: what happened, what is still required, and that it persists — plus a durable record. "Source connected at 2:41 PM. 30 days of events loaded. Nothing else needed. Data refreshes every 5 minutes." [L8, M7b P5]
20. **Model states explicitly**: Draft → Sending/Processing → Sent/Done → Accepted/Declined → **Failed** → **Unresolved**. A lost connection is *not* proof of failure: check real status before offering retry; never allow duplicate submissions [M8a].
21. **Never collapse distinct events** into a generic "Success!" (saved vs. published; invited vs. joined; connected vs. data loaded) [M8a, M8b].
22. **Make waiting predictable**: say when the next update comes ("We'll email you when the import finishes, usually under 10 minutes") so users can stop checking [L8].

### A5. Interruptions and return
23. Classify every signal as **Available**, **Noticeable** or **Interruptive**. Interrupt only when delay has real cost. Batch routine updates into user-controlled digests [L7].
24. **No mid-task popups or secondary asks** (invite teammates, rate us, enable notifications, upgrade). Wait for a natural boundary [L7, A2].
25. **On return, restore orientation, not just data**: position, unfinished items, next action, and a relevant summary — "Since you left: import finished; 1 source needs reauth" — never just "17 updates" or a first-page reset [L1, L8, M7b P11].
26. **No aggressive timeouts.** Pausing must never cost the user work [M7b P1].

### A6. Errors, control, automation
27. Provide **undo, cancel, back, edit-before-commit**. Match recovery to failure: *undo* (slip), *retry* (failed transfer), *resume* (expired session), *restore* (lost draft). Don't offer Retry when the information needed to retry is gone [M7b P10].
28. **Error copy** = what failed + what was kept + the safe next action. No blame, proportionate tone [M9a, M9b, L10].
29. **AI output** (generated insights, suggested funnels, auto-written queries, rankings) must be **inspectable, explainable, editable and rejectable**. "Support is not the same as substitution" [L2, M7b P6].
30. **Personalization** must be explained, overridable and reversible; keep a recognizable structure; old layout restorable [M7b P18].

### A7. Engagement ethics — hard constraints
The course treats these as risks to the user, not growth tactics [L3, L4, L8, L11, M7b]. **Do not use:**
- streaks or "don't lose your progress" mechanics
- loss/expiry warnings, countdowns, fake urgency
- leaderboards or rankings that turn users against each other
- fake scarcity or social pressure ("3 teammates are waiting")
- variable-reward "check for new insights" refresh loops
- endless feeds without an end state; autoplay-style chaining
- anticipation cues that never resolve (spinners, "something new may be arriving…")
- red badges on routine items (badge meaning generalizes from other apps)
- fear- or comparison-based copy
- notification permission folded into the setup path
- exit harder than entry (cancel/delete/export must be as easy as signup)

**Do use:** immediate specific feedback tied to real outcomes · competence/outcome evidence instead of activity counts · milestones · purpose cues · choice · recognition of contribution · predictable, batched, event-driven notifications users can act on or dismiss · safe pausing · cheap re-entry · easy pause, opt-out, export and deletion.

**Test every return loop two ways [L11]:**
- **Support vs. control:** can the user snooze, reschedule or ignore it at no penalty?
- **Removal test:** remove the badge/reminder/streak — would users still return for the value? If not, fix the value, not the loop.

### A8. Accessibility and inclusion
31. Fully **keyboard-operable**, semantic elements, visible focus. **Color never the only cue.** Meet WCAG 2.2 contrast and target size [M9b].
32. **Plain language** in users' own terms ("Submit assignment for grading", not "Commit assessment transaction") [M9b].
33. Real mobile layouts (not shrunken desktop); support switching devices mid-flow. Design for interrupted, fatigued, novice and second-language users [M8b, M9b].

---

## Part B — The concepts behind the rules (course content, condensed)

### B1. Cognitive alignment (Module 1) [L1, L2]
- Interaction requires a person to **notice, keep track of, understand, anticipate, decide and act**; most of this happens in the person, not on screen. Design **redistributes cognitive work** between interface and person. "Less work is not automatically better": a system that chooses every step can reduce understanding.
- **Continuity of interpretation:** the user can always answer *Where am I? What happened? What does this mean? What happens next?* Changing an interface can "reach backward" and invalidate earlier learning.
- **Productive effort** (learning, comparing, judging) vs. **compensatory effort** (rebuilding hidden context, hunting for state, resolving avoidable ambiguity). "Good HCI protects effort for the work that matters."
- **Three recurring questions:** *Anticipation* — what has the interaction taught the person to expect? *Closure* — can the activity reach a meaningful boundary? *Proportionality* — does the demand fit what the situation requires?
- Don't judge onboarding only by completion: a flow can be completed and still leave users checking and hesitating months later.

### B2. Behavioral architecture (Module 2) [L3, L4, A1]
- **Classical conditioning** (a badge/vibration acquires meaning by pairing), **operant conditioning** (consequences change future action), **timing** (immediate consequences are easier to link).
- **Intermittent reinforcement:** "Behavior can be sustained by the possibility of value." **Negative reinforcement:** behavior repeats because it removes discomfort (clearing a badge, saving a streak).
- **Closure** = recognizable endpoint; infinite feeds remove it. **Exit friction** = one click to stay, six to cancel. **Generalization** = response to one red badge spreads to all.
- **Shaping** — the course's own example *is onboarding*: choose interests → follow accounts → complete profile → enable notifications. "The user is learning where to click. But the sequence is also teaching a way of participating." **Chaining:** each step cues the next; with autoplay "the decision point has moved" — stopping becomes the effortful act.
- **Adaptive recursion:** the platform learns from behavior and changes its conditions; two learners become coupled.
- **Behavioral architecture** = the organization of conditions that jointly shape anticipation, action, continuation, return and stopping. "The mechanism is similar. The objective is not." Ask whether the system **supports, transforms, competes with, or interferes with** the user's original activity.
- **Apply:** treat onboarding as shaping *toward the user's goal* — every step should end in a consequence that visibly advances it (connecting data immediately renders a real chart).

### B3. Cognitive architecture (Module 3) [L5, L6]
- **Perception** is active organization (proximity, similarity, continuity, closure + prior experience). When cues disagree, interpretation becomes unstable.
- **Action legibility:** affordance (what's possible) · signifier (where/how) · mapping (control → effect) · feedback (what happened).
- **Attention:** bottom-up salience vs. goal-directed selection. "ON SCREEN ≠ IN COGNITION." Prominence should be proportional to importance, cost of missing it, and cost of interrupting.
- **Working memory** holds an organized configuration (goal, state, open question, prior decision, next intention); an interruption breaks the whole configuration.
- **Distributed cognition:** move from REMEMBER to INSPECT (checklists, breadcrumbs, histories). Uncoordinated supports cause "distributed fragmentation."
- **Long-term memory:** episodic, semantic, procedural; **chunking**; **cognitive load** — task-inherent vs. interface-created. "The goal is not simply less effort. It is effort spent on the right work."
- **Schemas, mental models, scripts, transfer** (false transfer is costly: a star = favorite in one app, publish in another). **Cognitive state** (fatigue, stress, time pressure) pushes users to defaults and heuristics. **Prospective memory** holds intentions for later — support it ("Finish connecting later?").
- **Slip vs. model failure:** a slip needs undo; a model failure needs a revised understanding (explanation). Recovery ≠ reflection.
- Don't stack small early demands (confirmations, preference pickers, warnings) — they accumulate and degrade later decisions.

### B4. Neurobiology, interruption and rhythm (Module 4) [L7, L8]
- Functional networks (simplifications, not modules): **CEN** maintains goals; **DMN** integrates memory/simulation; **Salience Network** detects consequential change. **Evidence boundary:** never claim a feature "activates" a network or "releases dopamine" [A2].
- "Novelty ≠ importance. What captures attention and what deserves attention can diverge."
- **Salience arbitration:** Available / Noticeable / Interruptive, proportional to the cost of delayed attention. **Priority levers:** timing, placement, modality/intensity, persistence, interruptiveness, aggregation (batching).
- **Switching costs:** reconfiguration, **cognitive residue**, regulatory cascade, fragmentation; expecting signals creates **vigilance** (monitoring with no cue).
- **Regulatory alignment:** "Preserve sustained cognitive organization by default, while escalating signals when the consequence of delay genuinely justifies interruption."
- **Closure** lets cognition move from maintaining → resolving → releasing. "Processing…" without confirmation transfers uncertainty to the user.
- **Entrainment:** predictable timing reduces monitoring ("grades always appear Friday 5 PM"). Who sets the tempo — system or user?
- **Prediction error** gives events their pull; cues acquire pull through learned expectation. **Uncertainty + Consequence + Checkability → ongoing monitoring.** "We will notify you at 3:00 PM" resolves it.
- **State matters:** the same popup costs more after an hour of hard work. "Uncertainty about the person does not justify unnecessary demand."

### B5. Cognitive models (Module 5) [L9]
- "Behavior is evidence about cognition, not a complete description of it." The same click can come from different processes; don't infer confusion or motivation from clicks alone.
- **HTA** (goals/subgoals/operations/plans) exposes interface-created steps and fragile ordering. Example: *0 Get insight → 1 Create account → 2 Connect source → 3 See first chart → 4 Ask a question → 5 Save to dashboard → 6 Invite team.*
- **CTA** captures cues, judgments and tacit expertise (what experts look at to decide a metric is "off") — surface those cues instead of making users hunt.
- **GOMS/KLM** predict routine expert time (T = M + P + K…) — weak for first-time discovery; don't use keystroke-minimization to justify a first-run design.
- **Human processor anchors:** perceptual ≈100 ms, cognitive ≈70 ms, motor ≈70 ms (anchors, not constants). "Latency can transform a motor action into an uncertainty-management problem."
- **Norman's action cycle** and its two gulfs: **Execution** (how do I make it happen?) and **Evaluation** (did it happen?). Check both at every step.
- "Good modeling simplifies deliberately, predicts within its scope, and keeps its omissions visible."

### B6. Motivation and emotion (Lectures 10–11) [L10, L11]
- **Motivation** initiates, guides and sustains goal-directed behavior; it's a **state, not a stored quantity**. **Affect** = valence, arousal (keep in a workable range), **perceived control**. **Readiness** is "the floor, not motivation itself."
- Unexplained failure, ambiguous delay and irreversibility push users toward vigilance and avoidance. **Predictable pacing, visible progress, reversibility and legibility** reduce regulatory work: "users infer less because the interface represents more."
- **Task preservation vs. task-state preservation:** "Draft saved" isn't enough — also restore what they were editing and the unresolved error. Recovery mechanisms: autosave, resumption cues, visible history. **Safe pausing:** "I can stop here and continue later."
- **Motivational scaffolding:** progress cues, prompts, milestones, competence feedback, choice, purpose cues.
- **Goal displacement:** "I want to learn Spanish" becomes "I cannot lose my 180-day streak." **"Engagement can rise while autonomy falls."**
- **Support vs. control:** support says "Snooze, reschedule, or begin"; control says "Complete a lesson now to avoid losing it."
- **Competence evidence beats activity counts** ("You found why signups dropped" > "You opened 12 charts"). **Relevance outside the app.** **Recognition without ranking; belonging without proving presence.**

### B7. The Codex of Cognitive Alignment — 18 principles [M7b]
Reason each as *cognitive problem → design responsibility → interface response → consequence*. "Not a set of mandatory features, nor a replacement for usability or accessibility." Three clusters: **Cognitive anchors (1–9)**, **Rhythmic & embodied commitments (10–12)**, **Resilient, inclusive & adaptive design (13–18)**.

| # | Principle | Responsibility | Onboarding application |
|---|---|---|---|
| 1 | Timing thresholds | Pace within sustainable tempos; separate system latency, decision time and interaction tempo | No aggressive session timeouts; keep progress during long deliberation; warn early and save work |
| 2 | Neural anchoring | Stable attentional conditions for reflection and decisions | No popups while the user is reading their first results |
| 3 | Alignment as duty | "Technical correctness does not establish cognitive appropriateness" | Own the foreseeable burden of every step you add |
| 4 | Growth-oriented reinforcement | Reward progress and mastery, not compliance or frequency | Celebrate the first real insight, not logins or "profile 80% complete" |
| 5 | Closure for confidence | Initiated → processing → confirmed; durable receipts; state what's still required | "Invite sent to sam@acme.com at 2:41 PM. They'll appear in Team once they accept." |
| 6 | Caution against premature automation | Recommendations inspectable, correctable, rejectable; match automation to stakes and expertise | AI-generated insights show their query; user can edit or dismiss |
| 7 | Attentional corridors | Protect focus; defer nonessential interruptions; preserve context for return | Hold "invite your team" until setup reaches a boundary |
| 8 | Memory scaffolds | Persistent selections, comparisons, histories, saved state, progressive disclosure | Keep chosen source, project and range visible across steps |
| 9 | Salience balance | Urgency matches importance: routine → subtle, action soon → contextual, real risk → prominent | Only a failed data connection gets a prominent alert |
| 10 | Recovery defaults | Undo, pause, retry, resume, quiet mode — matched to the failure | Retry a failed import without re-entering credentials |
| 11 | Resilience scaffolds | Restore orientation: completed vs. pending, next step, reduced demand | "Saved at 3:42 PM. Steps 1–2 done. Continue: connect your second source." |
| 12 | Oscillatory rhythm stewardship | Stable work periods, predictable transitions, no repeated artificial urgency | Weekly digest instead of daily nags |
| 13 | Plural modeling | Don't intervene from activity counts alone; combine logs, interviews, observation, assessment | Low logins ≠ disengaged (they may read the email digest) |
| 14 | Load thresholds | Separate intrinsic, extraneous and useful load; foreground what matters now; reveal detail progressively | Advanced options collapsed until needed |
| 15 | Predictive negligence | Examine model limits and consequences of prediction-triggered actions; preserve oversight | "At-risk user" scores never auto-trigger restrictions or nag sequences |
| 16 | Motivation balance | Autonomy, competence, relatedness; "avoid punitive streak resets" | Choice of path; no punishment for absence |
| 17 | Emotional safety | Proportionate language; "avoid manipulative fear and comparison"; give an explanation and next step | No alarming copy for minor anomalies |
| 18 | Personalization stewardship | Explain adaptation, keep structure recognizable, allow override and reversal | Reordered dashboards are explained and restorable |

**Principles conflict:** automation lowers load but can weaken judgment; stronger warnings raise salience but cost emotional safety; showing everything aids memory but overwhelms attention; extra confirmation improves closure but adds timing burden. Decide by naming the most consequential responsibilities for the activity and its risk. Decision discipline: *difficulty → relevant principles → expected mechanism → competing responsibilities → evidence needed.*

### B8. Design thinking and personas (Module 7) [L12]
- Empathize/Define/Ideate/Prototype/Test are recurring activities, not a line; testing can show the *problem* was framed wrong. Situated action (plans guide, don't determine); reflection-in-action. What people say ≠ what they do.
- Choose methods by evidence type (interviews, contextual inquiry, observation, diary studies, surveys, logs). Affinity mapping — keep counterexamples visible.
- **Personas** are research-informed and only useful when an attribute changes a requirement; behavior patterns beat biography. Mark unresearched attributes **provisional**. Empathy maps (Says/Does/Thinks/Feels, inferences labeled). **Journey maps:** stages × goals, actions, touchpoints, friction — the insight is often *between* stages (Discover → Set up → First value → Act → Return).
- "A user request is not a requirement." Keep **observation → interpretation → problem → proposed solution** separate. A defensible problem statement names who, goal, conditions, evidence and consequences, and does not prescribe a feature.
- **How Might We** questions; avoid fixation via divergence by *mechanism*, brainwriting, **assumption inversion** ("what if an extra step prevents a consequential mistake?"), analogies. Converge on explicit criteria. Keep a traceable **decision log** (evidence → interpretation → problem → opportunity → response).

### B9. Prototyping, scenarios, wireflows (Module 8) [M8a, M8b]
- **Scenarios** name person, goal, context, actions, system behavior and outcome, with decisions and success conditions. Write at least: **everyday** (setup in one sitting), **interrupted** (leaves mid-setup, returns on phone two days later), **stress/failure** (import partially fails), **collective** (two teammates share one workspace).
- **Storyboards** place frames at meaningful state changes. Requirement ≠ solution ("make the selected source identifiable" is a requirement; a highlighted card is one solution).
- **"Interfaces have states, not just screens":** Ready, In progress, Processing, Accepted, Failed, **Unresolved**. Never prompt an unsafe retry while status is unresolved.
- **Wireflows** connect screens with user and system events: normal path, recovery branch, a route to change selections before committing, a clear completion state, and a note of what is preserved, cleared or updated during recovery [FP].
- Fidelity (visual, content, interaction, behavioral, contextual) is independent of functional depth. Implement what must function; simulate what only needs representing; document implemented / simulated / out of scope. Accessibility belongs *in* the prototype. A prototype demonstrates a proposition; it doesn't validate it.

### B10. Expert review (Module 9) [M9a, M9b]
- **Cognitive walkthrough:** define user, prior knowledge, goal, start point, success condition; at each step ask (1) will they try to achieve the right effect? (2) notice the action? (3) associate it with the effect? (4) understand the feedback? Record: location · observation · predicted breakdown · consequence · correction · evidence still needed. Experts miss newcomer problems.
- **Nielsen's 10:** visibility of status; match with the real world; user control and freedom; consistency and standards; error prevention; recognition over recall; flexibility and efficiency; aesthetic and minimalist design; recognize/diagnose/recover from errors; help and documentation. Heuristics are lenses, not mechanical rules (Snooze ≠ Mute).
- **Severity 0–4** (none, cosmetic, minor, major, catastrophe) = frequency × impact × persistence, with a stated reason. Personal preference isn't evidence.
- **WCAG 2.2 audit** (perceivable, operable, understandable, robust; e.g. SC 2.1.1 Keyboard). **Inclusive review** (unfamiliar terms, screen readers, frequent interruptions, limited working memory, second-language users; replace hidden multi-screen choices with a persistent summary). **Affective audit** (blaming copy reduces control; urgency only when real). **ISO 9241-110** (task suitability, self-descriptiveness, conformity with expectations, learnability, controllability, use-error robustness, user engagement).
- Reviewers inspect independently first to avoid anchoring. **AI-assisted review:** verify every claim — "fluent explanation is not proof." **Regression review:** a fix can break something else; reinspect.

### B11. Usability testing (Module 10) [M10A]
- Ask a researchable question ("Can new users connect a source, recognize completion and recover when import fails?"), not "is it easy?" Targets: **clarity, continuity, recovery, confidence**.
- Purposive/stratified sampling (coverage over size; screening questions; experienced users mask problems). Test across conditions: rested/fatigued, focused/interrupted, novice/familiar, calm/pressured. Weigh ecological validity (lab vs. remote vs. hybrid).
- **Tasks are goals, not instructions.** Define success up front as four separate measures: **technical completion, independent completion, status recognition, recovery** (functional, interpretive, confidence). Include an interrupt-and-resume task and a failure task.
- Pilot the study; think-aloud; neutral moderation ("What would you try next?"); blame-free framing ("We're evaluating the system, not you"); informed consent, compensation, privacy, right to withdraw. Observation ≠ interpretation.

### B12. Evidence and measurement (Module 11) [M11A, M11b]
- Operationalize: success rules; time-on-task with start/stop boundaries and a cap (timeouts count as failures); error episodes by codebook (an unfamiliar path isn't automatically an error); **recovery rate** measured separately from error prevention.
- Report median and distribution, not just mean; look at subgroups (first-time vs. experienced). Event logs: participant, timestamp, event, target, context — a revisit is observable, its reason is not. Keep provenance; clean duplicates but not genuine unusual behavior; minimal capture with consent.
- Reliability (test-retest, inter-rater) and validity (construct, criterion, ecological). **Proxy problem:** a correct click isn't comprehension — add comprehension checks.
- **SUS** (perceived usability) and **NASA-TLX** (workload) measure separable constructs. Small samples are unstable: use confidence intervals; separate statistical from practical importance; watch attrition and survivor bias. Triangulate with evidence that *discriminates* between explanations. **Measurement drift:** after a redesign the same metric can mean something else.

---

## Part C — Operating procedure for the agent

### C1. Before building
1. Write each persona (behavior-based, provisional where unresearched) and their goal.
2. Write an HTA per persona; strike interface-created steps.
3. Write the four scenarios (everyday, interrupted, failure, collective).
4. Draw the state model for every consequential action (Draft → Processing → Done/Failed/Unresolved), with safe-retry logic.
5. Classify every notification as Available / Noticeable / Interruptive, with its trigger (real event only) and cadence.
6. Log decisions as Diagnosis → Requirement → Decision → Expected effect → Tradeoff.

### C2. Self-check before shipping
- Cognitive walkthrough of each persona's first run (4 questions per step).
- Heuristic pass: Nielsen 10 + Codex 18, severity 0–4 with reasons.
- Keyboard-only and screen-reader pass; contrast and target sizes.
- Ethics pass against A7 (support vs. control; removal test).
- Regression check on every fix.

### C3. Checklist
**Goal & structure**
- [ ] Goal written per persona; every step visibly advances it; purpose cue on every input
- [ ] HTA exists; interface-created steps removed
- [ ] First real value reached early; optional setup deferred
- [ ] Steps skippable/deferrable; recommended next step plus alternatives

**Perception, attention, memory**
- [ ] Fields grouped by user concepts; grouping matches function
- [ ] Clear signifiers; destructive actions visually distinct
- [ ] Prior choices visible; review summary before commitment
- [ ] Salience hierarchy (routine subtle → action-needed contextual → urgent prominent); no uniform red badges
- [ ] Users' language; familiar icons keep familiar meanings

**Feedback, closure, state**
- [ ] ~200 ms acknowledgment; determinate progress beyond ~1 s
- [ ] Consequential actions end with state, remaining obligation, persistence, durable record
- [ ] Failed and Unresolved modeled; retry is safe and never duplicates
- [ ] Waits say when the next update comes

**Interruption & return**
- [ ] Autosave; resume restores position, unfinished items and next action
- [ ] Return screen summarizes relevant changes since last visit
- [ ] No nonessential prompts mid-task
- [ ] No aggressive timeouts

**Errors & control**
- [ ] Undo, cancel, back, edit-before-commit; errors say what happened, what was kept, what next — no blame
- [ ] AI suggestions inspectable, editable, rejectable
- [ ] Personalization explained, overridable, reversible

**Motivation & ethics**
- [ ] None of the A7 "do not use" mechanisms
- [ ] Feedback reflects competence/real outcomes, not activity counts
- [ ] Guidance tapers for returning/expert users
- [ ] Notification permission requested in context with a concrete benefit; digests user-controlled
- [ ] Pause, opt-out, export and deletion as easy as signup

**Accessibility**
- [ ] Keyboard-complete with semantic elements and visible focus
- [ ] Color never the only cue; WCAG 2.2 contrast and target size
- [ ] Real mobile layout; survives device switching

**Traceability**
- [ ] Every decision logged as evidence → requirement → decision → expected effect → tradeoff

### C4. How to measure it
- **Expert pass first:** walkthrough per persona, Nielsen + Codex severity review, WCAG audit, affective copy audit. Verify AI-generated findings.
- **Formative test:** 5–8 participants per persona chosen purposively; goal-based tasks including interrupt-and-resume and failure-recovery; think-aloud; piloted protocol.
- **Per-task metrics (separately):** technical completion, independent completion, status recognition ("Is anything else required?"), recovery, time-on-task (median + distribution), errors + recovery rate, repeated-checking count.
- **Self-report:** SUS, raw NASA-TLX, comprehension check ("What data can this product read right now?", "What happens after you click Connect?").
- **Production:** step drop-off; time-to-first-value; returns triggered by real events vs. unprompted checking; read retention/DAU only alongside goal outcomes. Revalidate metrics after any redesign.

---

**Source key** — SYL: Syllabus · L1–L12: Lectures 1–12 (L12 = Design Thinking) · M7b: Codex lecture · M8a/M8b: Prototyping & wireflows · M9a/M9b: Expert review & accessibility · M10A: Usability testing · M11A/M11b: Quantitative evidence · A1–A3: Assignments · FP: Final Project.
