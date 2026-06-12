---
status: accepted
---

# All projected geometry operations use EPSG:32618 (UTM 18N, metres)

Buffered overlap math (facility proximity, dedup), length computation, and any
distance threshold must be done in a projected CRS — never in EPSG:4326
(degrees). Two candidates were on the table: EPSG:2263 (NY State Plane Long
Island, US survey **feet**) and EPSG:32618 (UTM zone 18N, **metres**).

**Decision:** standardise every projected operation on **EPSG:32618 (metres)**.

**Why:** all of our distance literals are written in metres (15 m facility
proximity, 25 m dedup buffer, 50 m gap/resample, 200 m loop closure). A
feet-based CRS forces a unit conversion at every call site, and a single missed
conversion is a silent correctness bug in scoring and dedup. UTM 18N is metric
and cleanly covers the entire metro extent, including the New Jersey (Bergen /
Hudson) and upstate (to Peekskill) portions where State Plane Long Island
accuracy degrades.

**Consequence:** reversible but not free — changing CRS later means re-running
Phase 3 scoring and the dedup pass. Recorded so nobody "optimises" to State
Plane feet and reintroduces the unit-mix hazard.
