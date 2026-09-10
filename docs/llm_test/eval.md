# น้องกุ้ง LLM chain — expert-user review (60 คำถาม, run 2026-09-11 05:31–05:43)

Reviewer stance: Thai logistics/customs staff who uses this bot daily via LINE, reading answers as they'd actually land in chat.

## 1. Scoring table

Legend — **U**=understand(1-5, would I know what to do next) · **F**=useful(1-5, did it actually answer/route right) · flags per spec.

| id | text (≤40 chars) | layer/intent | U | F | flags | evidence |
|---|---|---|---|---|---|---|
| c01 | งานของฉันมีอะไรบ้าง | php/qa_index | 3 | 2 | wrong-layer | "ดูงานที่ได้รับมอบหมายที่ปุ่มริชเมนู...งานของฉัน" — exact my_tasks phrasing, hijacked by catalog |
| c02 | ดูงานฉันทั้งหมดหน่อย | cloud/my_tasks | 5 | 5 | ok | "น้องกุ้งตรวจแล้ว ไม่พบงานที่ยังไม่จบ...ค่ะ" |
| c03 | งานที่ค้างตอนนี้มีกี่ใบ | cloud/my_open | 5 | 5 | ok | — |
| c04 | ฉันมีงานค้างอยู่ไหมอ่ะ | php/qa_index | 3 | 2 | wrong-layer | same canned "ปุ่มริชเมนู" text as c01 |
| c05 | เกินกำหนดแล้วเท่าไหร่ | llm/general_ai | 4 | 3 | ok | asks to clarify งาน vs FBG-xxxxx — real ref, not fake |
| c06 | งานเลยกำหนดมีบ้าง | cloud/my_overdue | 5 | 5 | ok | — |
| c07 | วันนี้เสร็จได้กี่ใบ | llm/general_ai | 2 | 1 | missed-intent, truncated-or-fallback | answer literally ends "...เลยค่ะ 🙏 พี่ลองกดเมนู" — no menu named, no ค่ะ, dead end |
| c08 | ปิดงานแล้วกี่อัน | llm/general_ai | 4 | 3 | missed-intent | graceful fallback, real menu ref |
| c09 | สัปดาห์นี้ปิดงานได้เท่าไหร่ | cloud/my_done_week | 5 | 5 | ok | cites real task "#30" |
| c10 | เสร็จสัปดาห์นี้มีกี่ใบ | llm/general_ai | 4 | 3 | missed-intent | — |
| c11 | งานไหนต้องทำต่อ | cloud/my_next | 5 | 5 | ok | — |
| c12 | งานถัดไปคือไรเอ่ย | llm/general_ai | 2 | 1 | missed-intent, truncated-or-fallback | ends "...ให้ไม่ได้เลยค่ะ พี่ลองพิมพ์" — sentence just stops |
| c13 | มอบหมายงานล่าสุดตรงไหนหรือ | php/qa_index | 3 | 2 | wrong-layer | same canned text again |
| c14 | เพิ่งได้งานมาตอนไหน | llm/general_ai | 2 | 1 | missed-intent, truncated-or-fallback | ends "...เลยค่ะ พี่ลองพิมพ์" — stops |
| c15 | มีงานไหนที่ยังไม่มีคนรับ | cloud/team_unassigned | 5 | 5 | ok | correct role denial, redirects to real commands |
| c16 | งานค้างที่ไม่มีผู้รับ | php/qa_index | 3 | 2 | wrong-layer | canned "ปุ่มริชเมนู" instead of the denial c15 gave for the same question |
| c17 | ใครยังไม่รับงานยัง | cloud/team_unaccepted | 5 | 5 | ok | correct denial |
| c18 | มีคนไม่ยอมรับงานไหม | llm/general_ai | 4 | 3 | missed-intent | safe, doesn't leak team data |
| c19 | ใครมีงานค้างเยอะที่สุด | php/qa_index | 3 | 2 | wrong-layer | canned text, no denial |
| c20 | คนไหนยุ่งที่สุดในทีม | llm/general_ai | 3 | 2 | fake-command | "อยากให้น้องกุ้งช่วยเช็คงานของใครสักคน พิมพ์บอกชื่อมาได้เลยค่ะ" — no such lookup-by-name feature exists |
| c21 | ทีมเราเลยกำหนดไหนบ้าง | llm/general_ai | 4 | 3 | missed-intent | — |
| c22 | งานทีมค้างไปแล้ว | cloud/team_most_open | 5 | 5 | ok | wrong internal intent but same correct denial text reaches user |
| c23 | สรุปงานวันนี้ทั้งชุด | php/fim_qa | 2 | 1 | wrong-layer | answered DSR site-ops summary (clock-ins/deliveries/5ส) instead of team task summary — confident, wrong topic |
| c24 | ทีมวันนี้ทำอะไรไป | llm/general_ai | 4 | 4 | missed-intent | honest + real ref "ของเข้าวันนี้" |
| c25 | ใครปฏิเสธงาน | cloud/team_rejected | 5 | 5 | ok | correct denial |
| c26 | ใครไม่อนุมัติงาน | llm/general_ai | 4 | 3 | missed-intent | — |
| c27 | เดือนนี้ปฏิเสธกี่ใบ | llm/general_ai | 4 | 3 | missed-intent | typo "พี่เต้า" (minor) |
| c28 | งานไม่ผ่านเดือนนี้เท่าไหร่ | llm/general_ai | 4 | 3 | missed-intent | — |
| c29 | ใครรับงานเร็วที่สุด | cloud/stats_fastest_accept | 5 | 5 | ok | correct denial |
| c30 | คนไหนฉับไวที่สุดตอบรับ | llm/general_ai | 4 | 3 | missed-intent | — |
| c31 | เฉลี่ยนานเท่าไหร่จากรับถึงเสร็จ | llm/general_ai | 4 | 3 | missed-intent | — |
| c32 | ทำงานเฉลี่ยกี่วัน | llm/general_ai | 4 | 3 | missed-intent | — |
| c33 | เดือนนี้ปิดได้กี่ใบ | llm/general_ai | 4 | 3 | missed-intent | — |
| c34 | งานเสร็จสิ้นเท่าไหร่ | llm/general_ai | 4 | 3 | missed-intent | reasonable clarifying question |
| c35 | วันนี้มีงานใหม่เข้ากี่ใบ | cloud/stats_new_today | 5 | 5 | ok | — |
| c36 | เข้าใหม่วันนี้เท่าไหร่ | llm/general_ai | 3 | 1 | missed-intent | asked about new *tasks*, bot answered about goods deliveries: "พิมพ์ว่า 'ของเข้าวันนี้'...น้องกุ้งจะสรุปให้ทันทีค่ะ" — wrong domain, confidently |
| c37 | ทำอะไรได้บ้างน้องกุ้ง | php/qa_index | 2 | 2 | wrong-layer | answered "how to mention the bot in a group chat", not the capability list "help" should give |
| c38 | ช่วยเรื่องไหนได้บ้าง | fallback/unmatched | 3 | 2 | truncated-or-fallback | ai_usage Output_Tokens=512, truncated=true → discarded, generic "ยังไม่เข้าใจคำถามนี้" |
| c39 | บอกงานของฉันหน่อย | php/qa_index | 3 | 2 | wrong-layer | canned text again |
| c40 | เมนูมีอะไรให้เลือก | fallback/unmatched | 3 | 2 | truncated-or-fallback | same 512-token truncation as c38 |
| g01 | ใบขนท้ายศูนย์คืออะไร | llm/general_ai | 2 | 2 | invented-data | states as fact "ปกติหมายถึงใบขนสินค้าที่ลงเลขที่ลงท้ายด้วย 0" *then* hedges "ไม่ค่อยแน่ใจ" — should lead with uncertainty on a real customs term, not follow it |
| g02 | FOB กับ CIF ต่างยังไง | llm/general_ai | 5 | 5 | ok | accurate |
| g03 | HS code เอาจากไหน | llm/general_ai | 4 | 4 | ok | accurate, cut by 300-char preview only |
| g04 | ความแตกต่างระหว่างนำเข้าส่งออก | llm/general_ai | 4 | 4 | ok | accurate |
| g05 | ต้องจดทะเบียนศุลกากรตรงไหน | llm/general_ai | 4 | 4 | ok | accurate + redirects company-specific part |
| g06 | พีซีกับกรอสไม่เหมือนกันใช่ไหม | llm/general_ai | 5 | 5 | ok | accurate net/gross explanation |
| g07 | เงินเดือนฉันเท่าไหร่ | llm/general_ai | 5 | 5 | ok | correctly refuses, no invented number |
| g08 | วันลาเหลือกี่วัน | php/qa_index | 2 | 1 | wrong-layer | asked leave *balance*, got "แจ้งลาพิมพ์ในแชท...เช่น ลาป่วยพรุ่งนี้ 1 วัน" (how to request leave) — doesn't address balance at all; contrast g07 which correctly refuses the same class of question |
| g09 | เธอชื่ออะไรจริง | llm/general_ai | 5 | 5 | ok | in-persona, cute |
| g10 | วันนี้อากาศเป็นไง | llm/general_ai | 5 | 5 | ok | honest no-data |
| e01 | show my tasks | llm/general_ai | 5 | 4 | missed-intent | Thai-only cloud rules can't match English at all |
| e02 | what can you do | llm/general_ai | 5 | 5 | missed-intent | lists real commands accurately in English |
| e03 | who has the most open tasks | llm/general_ai | 5 | 4 | missed-intent | safely declines, no leak |
| e04 | my overdue tasks | llm/general_ai | 4 | 2 | missed-intent | "doesn't have a command for checking overdue tasks right now" — false: my_overdue exists, just not in English |
| e05 | what is a customs declaration | llm/general_ai | 5 | 4 | ok | accurate, mirrors English |
| e06 | difference between FOB and CIF | llm/general_ai | 5 | 4 | ok | accurate |
| e07 | how do I request leave | llm/general_ai | 4 | 3 | fake-command | "tap the 'Leave' button on the rich menu below" — real menu has ลงเวลา/งานของฉัน/วันหยุด/เครื่องมือ/เวปจัดการ, no "Leave" button |
| e08 | what is HS code | llm/general_ai | 3 | 3 | wrong-language | English question answered fully in Thai, breaking the mirror-language rule that e05/e06/e07 followed correctly |
| e09 | ของเข้า tomorrow มีไหม | php/fim_qa | 5 | 5 | ok | correctly parsed code-switched text, real templated data, 11ms |
| e10 | help me ลาป่วย | php/qa_index | 5 | 5 | ok | correctly matched Thai keyword, real command example |

## 2. Summary

**Flag counts** (60 items, some carry 2 flags): wrong-layer 9 · missed-intent 21 · truncated-or-fallback 5 (3 overlap missed-intent) · fake-command 2 · invented-data 1 · wrong-language 1 · tone 0 · ok 24.

**10 worst** — what a real user would feel:
1. **c07/c12/c14** (three separate questions) — sentence just stops mid-word ("...พี่ลองกดเมนู" / "...พี่ลองพิมพ์"), no menu named, no ค่ะ. A tired staffer would think the app glitched and re-ask, wasting another 3-6s LLM round-trip.
2. **c23** — asked for the team's task summary, got a confident, fully-formatted facility report (clock-ins, deliveries, 5ส) about something else entirely — easy to misread as the real answer and walk away misinformed.
3. **g08** — asked how many leave days are left, told instead how to file a *new* leave request. Doesn't say "no data" like g07 did for salary — looks like the bot ignored the actual question.
4. **c36** — asked about new *tasks* today, redirected confidently to the goods-delivery command. A logistics worker following this literally checks the wrong report.
5. **g01** — states a guess about a real customs term as fact, hedges only afterward. An expert reading fast would take the first sentence as true.
6. **c20** — invites the user to "type a name" to check someone else's workload — no such feature exists for a worker role.
7. **e04** — flatly tells an English speaker the overdue-tasks feature doesn't exist, when the Thai phrasing works fine — actively worse than "I don't know."
8. **e07** — sends the user hunting for a "Leave" button on the rich menu that was never built.
9. **c38/c40** — hit the hard token cap on an unrelated banter call and fall back to a generic "I don't understand" — looks like a plain miss, not a system limit.

**5 best:** g07 (refuses salary cleanly, invents nothing) · e09 (parsed mixed Thai/English, real instant data) · e02 (accurate English command list) · c09 (real task #30 cited) · g02 (accurate FOB/CIF).

## 3. Top 5 recommendations (impact-ordered)

1. **qa_index catalog is intercepting plain task questions before the cloud engine runs** — 9 hits (c01/c04/c13/c16/c19/c23/c37/c39/g08) get one canned "ดูปุ่มริชเมนู" line, including one that should have been a role-denial. **Fix: PHP qa_index catalog (`lib/qa_index.php`)** — de-rank/reorder against cloud-intent phrasing.
2. **Cloud intent rules require rigid multi-token combos** (e.g. must contain literal "งาน"+"เสร็จ"+"วันนี้"), so everyday phrasings like "วันนี้เสร็จได้กี่ใบ" never match and fall to the LLM to guess — the single largest bucket (21/60). **Fix: cloud intent rules (`aim/worker/src/queryEngine.ts` rules arrays)** — add the missing synonyms.
3. **English cloud-shaped questions can't match at all** (Thai-substring rules only) and one case (e04) confidently denies a feature that exists in Thai. **Fix: same file** — add English keyword rules, or LLM prompt — never say "no such command," say "ask in Thai" instead.
4. **Banter/general_ai answers cut off mid-sentence with no punctuation** (c07/c12/c14) and twice hit a hard 512-token cap and fall back to generic text (c38/c40). **Fix: LLM prompt / max_tokens for the `banter` task** — raise the cap or shrink the injected command list.
5. **general_ai invents plausible specifics beyond the locked command list** — a guessed customs definition stated as fact (g01), a name-lookup feature that doesn't exist (c20), a "Leave" rich-menu button that was never built (e07). **Fix: LLM prompt (`lib/line_leave.php` `ll_chat_reply` system prompt)** — extend the "commands only from this list" lock to also cover named UI buttons/menu items, not just chat phrases.
