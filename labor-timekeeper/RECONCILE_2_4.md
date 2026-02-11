# Week 2/4 Reconciliation: Manual vs Prod

## Audit Date: Feb 11, 2026

---

## 🔴 CRITICAL: Missing Days in Prod

Several employees are missing Mon 2/9 and/or Tue 2/10 entries:

| Employee | Mon 2/9 | Tue 2/10 | Missing Hours |
|---|---|---|---|
| **Boban Abbate** | ❌ MISSING | ⚠️ McGill 7h DRAFT (wrong) | ~16h |
| **Phil Henderson** | ❌ MISSING | ❌ MISSING | ~16h |
| **Sean Matthew** | ❌ MISSING | ❌ MISSING | ~24h (Fri also) |
| **Thomas Brinson** | ❌ MISSING | ❌ MISSING | ~16h |
| Chris Jacobi | ❌ MISSING | ❌ MISSING | (admin, no manual) |

---

## Employee-by-Employee Comparison

### Boban Abbate (Manual: 40h | Prod: 31h)
| Day | Manual | Prod | Match? |
|---|---|---|---|
| Wed 2/4 | Boyle 8h | Boyle 8h ✅ | ✅ |
| Thu 2/5 | Boyle 7h, Campbell 1h | Boyle 7h, Campbell 1h ✅ | ✅ |
| Fri 2/6 | Boyle 7h, Walsh-Insp 1h | Boyle 7h, Walsh 1h | ⚠️ "Walsh" vs "Walsh-Insp" |
| Mon 2/9 | Boyle 7h, Walsh-Maint 1h | ❌ MISSING | 🔴 NEEDS ENTRY |
| Tue 2/10 | Boyle 7h, Sweeney 1h | McGill 7h DRAFT | 🔴 WRONG DATA |

**Action needed:**
- Add Mon 2/9: Boyle 7h, Walsh-Maint 1h
- Fix Tue 2/10: Delete McGill 7h, Add Boyle 7h + Sweeney 1h
- Verify Walsh-Insp vs Walsh (client name mismatch)

---

### Jason Green (Manual: 40h | Prod: ~40.5h net)
| Day | Manual | Prod (net of lunch) | Diff |
|---|---|---|---|
| Wed 2/4 | Landy 4.5, Tubergen 3 = 7.5h | Landy 4.5, Turbergen 3, Boyle 0.5 = 8h | +0.5h Boyle extra |
| Thu 2/5 | Schauer 1, Richer 1.5, Tubergen 4, Watkins 1 = 7.5h | Schauer 1, Richer 1.5, Turbergen 4.5, Tubergen 1 = 8h | Watkins 1h→Tubergen 1h |
| Fri 2/6 | Richer 1, Muncey-Insp 1, Richer 1, Muncey-Maint 2.5, Schroeder 1, Jebsen 1, Landers 0.5 = 8h | Richer 1, Muncey 1, Richer 1, Muncey 3, Schroeder 1, Landers 1 = 8h | Muncey +0.5h, Landers +0.5h, Jebsen -1h |
| Mon 2/9 | Boyle 1, Lucas 1, Boyle 6 = 8h | Boyle 1, Lucas 1, Boyle 6.5 = 8.5h | Boyle +0.5h |
| Tue 2/10 | Lucas 0.5, McFarland 6, Lucas 1, Boyle 0.5 = 8h | Lucas 0.5, McFarland 6.5, Lucas 1 = 8h | McFarland +0.5h, Boyle -0.5h |

**Key Muncey discrepancy:**
- Manual: Muncey-Insp 1h + Muncey-Maint 2.5h = 3.5h total
- Prod: Muncey 1h + Muncey 3h = 4h total (0.5h over)
- Also: Prod uses plain "Muncey" — no Insp/Maint distinction

**Other issues:**
- "Turbergen" vs "Tubergen" spelling inconsistency in prod
- Missing Jebsen 1h on Fri, Watkins 1h on Thu
- Several small hour discrepancies (+/- 0.5h)

---

### Phil Henderson (Manual: 40h | Prod: 27h)
| Day | Manual | Prod (net) | Match? |
|---|---|---|---|
| Wed 2/4 | Watkins 6.5, Tubergen 1.5 = 8h | Watkins 7, Tubergen 1.5 = 8h | ⚠️ Watkins 7 vs 6.5 |
| Thu 2/5 | Watkins 8h | Watkins 8h ✅ | ✅ |
| Fri 2/6 | Watkins 8h | Watkins 8h ✅ | ✅ |
| Mon 2/9 | Watkins 8h | ❌ MISSING | 🔴 NEEDS ENTRY |
| Tue 2/10 | Watkins 8h | ❌ MISSING | 🔴 NEEDS ENTRY |

**Action needed:**
- Add Mon 2/9: Watkins 8h (with lunch)
- Add Tue 2/10: Watkins 8h (with lunch)

---

### Sean Matthew (Manual: 40h | Prod: 16h)
| Day | Manual | Prod | Match? |
|---|---|---|---|
| Wed 2/4 | Boyle 8h | Boyle 8h ✅ | ✅ |
| Thu 2/5 | JCW Shop 8h | Office 8h | ⚠️ "Office" vs "JCW Shop" |
| Fri 2/6 | PTO 8h | ❌ MISSING | 🔴 NEEDS ENTRY |
| Mon 2/9 | Boyle 8h | ❌ MISSING | 🔴 NEEDS ENTRY |
| Tue 2/10 | Boyle 8h | ❌ MISSING | 🔴 NEEDS ENTRY |

**Action needed:**
- Add Fri 2/6: PTO 8h
- Add Mon 2/9: Boyle 8h
- Add Tue 2/10: Boyle 8h
- Verify "Office" = "JCW Shop" (client name mismatch)

---

### Doug Kinsey (Manual: 40.25h | Prod: 48.25h)
| Day | Manual | Prod | Match? |
|---|---|---|---|
| Wed 2/4 | JCW Shop 7.5h | JCW 4.5 + JCW 3 = 7.5h ✅ | ✅ |
| Thu 2/5 | JCW Shop 7.5h | JCW 4.5 + JCW 3 = 7.5h ✅ | ✅ |
| Fri 2/6 | PTO 8h | JCW 4.5 + JCW 3.5 + PTO 8 = 16h | 🔴 EXTRA JCW 8h |
| Mon 2/9 | Boyle 9h | Boyle 5 + Boyle 4 = 9h ✅ | ✅ |
| Tue 2/10 | Watkins 4.75, Boyle 1.5, Lynn 2 = 8.25h | Watkins 4.75, Boyle 1.5, Lynn 2 = 8.25h ✅ | ✅ |

**Action needed:**
- Delete the 2 JCW entries on Fri 2/6 (JCW 4.5h + JCW 3.5h) — should be PTO only

---

### Thomas Brinson (Manual: 39.5h | Prod: 26h)
| Day | Manual | Prod (gross) | Match? |
|---|---|---|---|
| Wed 2/4 | Landy 8h | Landy 8.5 + Landy 1 + Boyle 2.5 + Lunch 0.5 = 12.5h | 🔴 WAY OVER (+4h) |
| Thu 2/5 | Boyle 4.5, Landy 1.5, Boyle 2 = 8h | Landy 1 + Boyle 3.5 + Lunch 0.5 = 5h | 🔴 WAY UNDER (-3h) |
| Fri 2/6 | Landy 1, Delacruz NB 0.5, Boyle 6.5 = 8h | Landy 0.5 + Boyle 4 + Lunch 0.5 + Boyle 3.5 = 8.5h | ⚠️ Missing Delacruz |
| Mon 2/9 | Landy 2, Boyle 2.5, Landy 1, Boyle 1, Landy 1.5 = 8h | ❌ MISSING | 🔴 NEEDS ENTRY |
| Tue 2/10 | Boyle 1, Landy 6.5, PTO 0.5 = 7.5h | ❌ MISSING | 🔴 NEEDS ENTRY |

**Action needed:**
- Fix Wed 2/4: Way too many entries (12h gross). Probably some belong to Thu.
- Fix Thu 2/5: Only 5h gross, should be ~8.5h gross
- Add Delacruz NB 0.5h on Fri
- Add Mon 2/9 and Tue 2/10 entries
- Add PTO 0.5h on Tue

---

## Summary of Required Actions

| Priority | Action | Employees Affected |
|---|---|---|
| 🔴 HIGH | Add missing Mon 2/9 entries | Boban, Phil, Sean, Thomas |
| 🔴 HIGH | Add missing Tue 2/10 entries | Phil, Sean, Thomas |
| 🔴 HIGH | Fix Boban Tue 2/10 (McGill→Boyle+Sweeney) | Boban |
| 🔴 HIGH | Delete extra JCW entries on Doug Fri 2/6 | Doug |
| 🔴 HIGH | Fix Thomas Wed/Thu entry split | Thomas |
| ⚠️ MED | Add Sean Fri 2/6 PTO 8h | Sean |
| ⚠️ MED | Fix Muncey hours for Jason (4h→3.5h) | Jason |
| ⚠️ MED | Add missing entries (Jebsen, Watkins) for Jason | Jason |
| ℹ️ LOW | Client name consistency (Walsh vs Walsh-Insp, Turbergen vs Tubergen) | Multiple |
