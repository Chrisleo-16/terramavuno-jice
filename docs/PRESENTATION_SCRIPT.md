# Presentation script

A full talk track for presenting **Nielekeze by TerraMavuno** — six minutes with
a three-minute cut, plus preflight, failure fallbacks and a Q&A bank.

`docs/DEMO_SCRIPT.md` is the *product* walkthrough, beat by beat. This document
is the *presentation*: what you say around the demo, what you do when something
breaks, and what you say when a judge pushes back.

Everything quoted here has been verified against the running build. Where a
number appears, it came out of the engine, not out of a pitch deck.

---

## T-30 minutes — preflight

```powershell
npm run dev:api        # Terminal 1
npm run dev            # Terminal 2
npm run test:live      # must exit 0
```

- [ ] `npm run test:live` shows no red `FAIL`.
- [ ] Browser open at **http://localhost:4173**, full screen, chat panel open.
- [ ] **Fly the demo path once on venue Wi-Fi** — Kenya → Murang'a → Kandara —
      so Cesium has the tiles cached. This is the single highest-value thing you
      can do before going on stage.
- [ ] Notifications off. Terminal font size up, in case you need to show it.
- [ ] Phone charged and on the same network if you plan the WhatsApp stretch.

### The one blocker to check

```powershell
Invoke-RestMethod http://localhost:8787/health
```

If `integrations.anthropic` is **false**, `ANTHROPIC_API_KEY` is unset and **the
chat panel will not answer.** Everything else — the map, the layers, the engine,
the result cards, voice, USSD — still works, but your demo has to be driven by
clicking rather than typing. Set the key, or rehearse the click path. Decide
which before you walk on, not on stage.

---

## The through-line

Say this to yourself before you start. Every beat serves it:

> **The information already exists. It just isn't answerable from where the
> farmer is standing. And the honest answer is sometimes "I don't know."**

If you only land one thing, land the second sentence. The refusal is the
product. Anyone can build a chatbot that always answers.

---

## 0:00 — 0:40 · The problem

**Do:** App booted, camera framing the whole of Kenya. Don't touch anything —
let the globe hold the national view while you talk.

**Say:**

> "A registered smallholder in Kandara wants to know one thing: *will I get the
> subsidised fertilizer, what will I pay, and where do I go?*
>
> Kenya publishes all of it. The rules are gazetted. The prices are gazetted.
> The depots are listed. None of that is secret.
>
> But today she answers that question by getting on a matatu, travelling to a
> depot, queueing, and finding out. A day of travel and a day of wages, to learn
> something the government already wrote down.
>
> We are not generating new information. We are making the information that
> already exists answerable from where she is standing."

**Why the Kenya-wide hold matters:** the camera is showing the scale of the
problem before you narrow to the pilot. Don't rush it.

---

## 0:40 — 1:10 · What you're looking at

**Do:** Let the camera descend into Murang'a. The six Kandara wards draw with
boundaries and labels.

**Say:**

> "Murang'a county, Kandara constituency. Six wards — Ng'araria, Muruka,
> Kagundu-ini, Gaichanjiru, Ithiru, Ruchu. Real boundaries, from geoBoundaries,
> IEBC-derived.
>
> One real NCPB depot, and three simulated agro-dealers that are labelled
> simulated everywhere they appear — on the map, in the card, in the API
> response. We never let a simulated fact wear an official costume.
>
> Every fact on this screen carries three tags: **who says so**, **how we know
> it**, and **when it was last checked**. Authority, derivation, freshness. That
> triple is the spine of the whole system."

---

## 1:10 — 2:10 · K-001, the confirmed farmer

**Do:** Ask for K-001 — typed, or the **"K-001 — will I get fertilizer?"** chip.

**Say, pointing at the card:**

> "**Confirmed.** She's in the register. Her national ID is linked. Two acres,
> under the five-acre cap. Her ward participates. Depot stock was verified this
> morning at six.
>
> **Four bags at 2,500 shillings**, against a market price of 6,500 — a saving
> of **sixteen thousand shillings**. NCPB Sagana Depot.
>
> Now the important part. **Claude did not decide any of that.** A deterministic
> function called `evaluateFarmer` decided it — pure, tested, no model in the
> loop. Claude's job is to explain the decision and cite it. Ask the same
> question a hundred times and the verdict is identical, because the verdict
> isn't being generated. It's being computed."

**If a judge is going to interrupt, it's here.** Good. That's the argument.

---

## 2:10 — 2:40 · The confirmed no

**Do:** Ask about **K-002**, then **K-003**.

**Say:**

> "A confirmed **no** is still a confirmed answer.
>
> K-002 is in the register, but her national ID was never linked. The card names
> the exact criterion that failed, and the next action: the ward agricultural
> office. Ten seconds, instead of a day of travel to be turned away.
>
> K-003 farms seven and a half acres — over the five-acre cap. Ineligible,
> confirmed, rule cited. We don't soften it and we don't apologise for it. The
> published rule is the published rule."

---

## 2:40 — 3:40 · The sijui moment

This is the centre of the presentation. Slow down. Let the pause sit.

**Do:** Ask for **K-004**. The amber **Indicated by published rules** pill
renders.

**Say:**

> "Here is the moment we built this for.
>
> K-004 passes every single published rule. Registered, ID linked, under the
> cap, participating ward. Every rule says yes.
>
> But his assigned depot is Kabati Agrovet, and its stock has **never been
> checked**. Not stale — never checked.
>
> Most systems round that up to 'yes, go'. Ours says, word for word:"

**Read the card verbatim. Don't paraphrase it:**

> **"Rules indicate you qualify, but I cannot verify today's stock at this
> depot."**

> "*Sijui.* I don't know — said precisely. Here is what I do know, here is
> exactly what I don't, here is what to do next.
>
> And there's a fifth farmer, K-005, where an eligibility input itself is
> unknown. That one doesn't get a hedged yes. It returns **cannot determine**,
> eligible **null** — not true, not false, null.
>
> A system that will not admit what it cannot verify is not one a farmer should
> trust with a day of travel and a day of wages. The refusal is not a gap in the
> product. It **is** the product."

---

## 3:40 — 4:30 · It reaches the actual farmer

**Say:**

> "Everything so far assumed a browser and a smartphone. Most Kenyan
> smallholders have neither.
>
> The same engine, the same citations, answer over **USSD and SMS** on a feature
> phone — under the 182-character limit, in English or Kiswahili. `STOP` opts a
> caller out and we then stay silent, including for advisories triggered
> elsewhere. If the network retries a message, we don't file the report twice or
> bill the farmer twice for an acknowledgement.
>
> And it's a return path, not just a broadcast. A farmer can report what she's
> seeing on the ground. That comes back tagged **community, unverified**, and it
> is never promoted to official evidence without review. Her phone number is
> salted and hashed before it's stored — we reject anything shaped like a raw
> number.
>
> Voice too, in Kiswahili, over the same tool layer."

**Stretch, only if rehearsed:** Share K-001's card → WhatsApp arrives on your
phone → hold it up. *"And the answer travels to where farmers actually are."*

---

## 4:30 — 5:10 · Why it holds up

**Say:**

> "Three things make this more than a demo.
>
> **One — the engine is not the model.** Eligibility is a pure, deterministic,
> unit-tested function. The model narrates; it never adjudicates. That's why the
> answer is reproducible and auditable.
>
> **Two — provenance is structural, not decorative.** Authority, derivation,
> freshness on every fact, all the way from the database to the sentence on the
> card. That's what lets the system know it *doesn't* know.
>
> **Three — it degrades honestly.** No API keys? The globe, the layers and the
> engine still run on bundled data. Database unreachable? It falls back and
> **tells you it fell back** — there's a `dataMode` badge on screen. It never
> quietly serves stale data dressed as live."

---

## 5:10 — 6:00 · Close

**Say:**

> "One programme, one constituency, six wards. Deliberately narrow — we'd rather
> be correct about Kandara than plausible about Kenya.
>
> But the truth model doesn't care that it's fertilizer. Authority, derivation,
> freshness applies to any public service where the rules are published and the
> answer is still out of reach: seed subsidies, school capitation, health
> commodities, water permits.
>
> TerraMavuno is the spatial evidence layer. *Nielekeze* — 'direct me' — is the
> first thing we're pointing it at.
>
> Know before you queue."

---

## The three-minute cut

When they cut your time — and they will — drop these, in this order:

1. Beat **4:30–5:10** (Why it holds up) — fold "the engine is not the model"
   into the K-001 beat instead.
2. **K-003** — K-002 already makes the confirmed-no point.
3. The farmer-channel beat, down to a single sentence: *"The same engine answers
   over USSD and SMS on a feature phone."*

**Never cut the sijui beat.** If you have ninety seconds, do the problem, K-001,
and K-004. That's the whole argument.

---

## When something breaks

Rehearse these. Composure in front of a broken demo reads better than a demo
that never breaks.

| What breaks | What you do | What you say |
|---|---|---|
| Chat returns an error | Click the farmer chips instead — they hit the engine directly | *"The engine is a separate service from the chat — let me go at it directly."* Then carry on. It's true, and it demonstrates the architecture. |
| Globe is slow / tiles blank | Keep talking over it; the layers draw regardless of imagery | *"Cesium's still pulling tiles on venue Wi-Fi — the boundaries and the data are local."* |
| Badge reads `dataMode: bundled` | Nothing — point at it | *"That's the fallback working. The database is unreachable and it's telling us so rather than pretending."* **This is a feature demo, not a failure.** |
| Voice won't connect | Skip it silently. Don't announce a missing feature | — |
| Imagery looks flat, no 3D | Ignore it | Only mention keyless mode if asked. |
| Total freeze | Reload; the flight is ~13 seconds | *"Let it re-fly — you'll see the opening again."* |

---

## Q&A bank

Short, honest answers. Do not oversell — the honesty is the differentiator, and
a judge who catches you inflating one claim will discount all of them.

**"Isn't this just a chatbot on a map?"**
> No — and the difference is testable. Eligibility is decided by a deterministic
> function with unit tests. Disconnect the model and the verdicts are unchanged.
> The model explains and cites; it never adjudicates.

**"How do you stop it hallucinating eligibility?"**
> It structurally can't. The model never computes a verdict — it calls
> `evaluate_farmer` and renders what comes back. If the data can't support a
> verdict, the engine returns `cannot_determine` and the card says so.

**"Is the data real?"**
> Mixed, and labelled. Ward boundaries are official, geoBoundaries/IEBC-derived.
> The programme rules and prices come from published MoALD sources with dates.
> NCPB Sagana is real. Three agro-dealers and all five farmer tokens are
> **simulated**, labelled as such everywhere. No real farmer PII exists in this
> system — the tokens are opaque, with no names, phones or ID numbers.

**"Why only six wards?"**
> Because we'd rather be correct about Kandara than plausible about Kenya. The
> ingestion path is the same for every county; what doesn't scale for free is
> the depot stock feed, and we're not going to pretend otherwise.

**"What happens when a farmer has no smartphone?"**
> USSD and SMS on a feature phone, same engine, same citations, under the
> 182-character limit, English or Kiswahili.

**"What's the hardest unsolved part?"**
> Depot stock freshness. Rules and prices are published and stable; live stock
> is not. That's exactly why `indicated_by_published_rules` exists as a distinct
> verdict — it's us refusing to paper over the one thing we can't verify.

**"How is this different from a government portal?"**
> A portal answers "what are the rules". This answers "what happens to *me*,
> today, at *my* depot" — and tells you when it can't.

**"Could an officer game it?"**
> The engine is deterministic and the trace is cited, so a wrong answer is
> traceable to a wrong input rather than to an opaque judgement. That's an
> auditability property a human queue doesn't have.

---

## Do not say

Claims the build won't survive. Each of these has a safe version.

| Don't say | Say instead |
|---|---|
| "Live government data" | "Published government sources, with dates and citations" |
| "Works across Kenya" | "Built for Kandara; the model generalises" |
| "Real farmers" | "Simulated farmer tokens, labelled simulated" |
| "Real-time stock" | "Stock with a checked-at timestamp — and we flag it when there isn't one" |
| "AI decides eligibility" | "A deterministic engine decides; the AI explains and cites" |
| "100% accurate" | "Reproducible and auditable — same input, same answer, every time" |
