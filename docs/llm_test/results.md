# ผลทดสอบสายตอบจริงของน้องกุ้ง

รันเมื่อ 2026-09-11 05:43:35 · run_start 2026-09-11 05:31:49 · 60 ข้อ

| id | group | expected | returned | layer | ms | tokens | truncated | answer |
|---|---|---|---|---|---:|---:|---|---|
| c01 | cloud | my_tasks | qa_index | php | 17 | - | - | ดูงานที่ได้รับมอบหมายที่ปุ่มริชเมนู "งานของฉัน" ค่ะ ส่วนหัวหน้างานจะมอบงานใหม่ พ |
| c02 | cloud | my_tasks | my_tasks | cloud | 153 | - | - | น้องกุ้งตรวจแล้ว ไม่พบงานที่ยังไม่จบของพี่ค่ะ |
| c03 | cloud | my_open | my_open | cloud | 177 | - | - | น้องกุ้งตรวจแล้ว ไม่มีงานค้างของพี่ค่ะ |
| c04 | cloud | my_open | qa_index | php | 4 | - | - | ดูงานที่ได้รับมอบหมายที่ปุ่มริชเมนู "งานของฉัน" ค่ะ ส่วนหัวหน้างานจะมอบงานใหม่ พ |
| c05 | cloud | my_overdue | general_ai | llm | 3915 | 133 | no | พี่หมายถึงงาน หรือของนำเข้าที่เกินกำหนดคะ? รบกวนบอกเลขที่เอกสาร (เช่น FBG-xxxxx) |
| c06 | cloud | my_overdue | my_overdue | cloud | 165 | - | - | น้องกุ้งตรวจแล้ว ไม่มีงานของพี่ที่เกินกำหนดค่ะ |
| c07 | cloud | my_done_today | general_ai | llm | 3247 | 98 | no | เรื่องจำนวนใบงานที่เสร็จวันนี้ น้องกุ้งยังไม่มีข้อมูลให้พี่ดูโดยตรงเลยค่ะ 🙏 พี่ล |
| c08 | cloud | my_done_today | general_ai | llm | 4322 | 191 | no | อันนี้น้องกุ้งยังไม่มีข้อมูลเรื่องจำนวนงานที่ปิดแล้วเลยค่ะ พี่ลองเช็คจากปุ่ม "งา |
| c09 | cloud | my_done_week | my_done_week | cloud | 173 | - | - | • งาน #30: ai ให้เช็คว่ามีเครื่องมือหายบ้างหรือเปล่า (เสร็จแล้ว) น้องกุ้งพบงานที |
| c10 | cloud | my_done_week | general_ai | llm | 3650 | 178 | no | เรื่องสรุปยอดใบงานเสร็จรายสัปดาห์แบบนี้ น้องกุ้งยังไม่มีข้อมูลให้เช็คได้เลยค่ะ พ |
| c11 | cloud | my_next | my_next | cloud | 154 | - | - | น้องกุ้งตรวจแล้ว ไม่มีงานถัดไปที่ยังไม่จบค่ะ |
| c12 | cloud | my_next | general_ai | llm | 3336 | 74 | no | ตอนนี้น้องกุ้งยังดูคิวงานล่วงหน้าให้ไม่ได้เลยค่ะ พี่ลองพิมพ์ |
| c13 | cloud | my_latest_assigned | qa_index | php | 5 | - | - | ดูงานที่ได้รับมอบหมายที่ปุ่มริชเมนู "งานของฉัน" ค่ะ ส่วนหัวหน้างานจะมอบงานใหม่ พ |
| c14 | cloud | my_latest_assigned | general_ai | llm | 2617 | 78 | no | ตอนนี้น้องกุ้งยังไม่มีข้อมูลงานที่พี่เพิ่งได้รับมาเลยค่ะ พี่ลองพิมพ์ |
| c15 | cloud | team_unassigned | team_unassigned | cloud | 133 | - | - | น้องกุ้งขออภัย คำถามข้อมูลทีมใช้ได้เฉพาะผู้จัดการหรือเจ้าของระบบ พี่ยังถามว่า "ง |
| c16 | cloud | team_unassigned | qa_index | php | 5 | - | - | ดูงานที่ได้รับมอบหมายที่ปุ่มริชเมนู "งานของฉัน" ค่ะ ส่วนหัวหน้างานจะมอบงานใหม่ พ |
| c17 | cloud | team_unaccepted | team_unaccepted | cloud | 117 | - | - | น้องกุ้งขออภัย คำถามข้อมูลทีมใช้ได้เฉพาะผู้จัดการหรือเจ้าของระบบ พี่ยังถามว่า "ง |
| c18 | cloud | team_unaccepted | general_ai | llm | 4733 | 210 | no | ตอนนี้น้องกุ้งยังไม่มีข้อมูลเรื่องการตรวจสอบสถานะรับ-ไม่รับงานของพนักงานคนอื่นเล |
| c19 | cloud | team_most_open | qa_index | php | 5 | - | - | ดูงานที่ได้รับมอบหมายที่ปุ่มริชเมนู "งานของฉัน" ค่ะ ส่วนหัวหน้างานจะมอบงานใหม่ พ |
| c20 | cloud | team_most_open | general_ai | llm | 5693 | 203 | no | อันนี้น้องกุ้งไม่แน่ใจค่ะ เพราะไม่มีข้อมูลเปรียบเทียบภาระงานของแต่ละคนแบบนั้นนะค |
| c21 | cloud | team_overdue | general_ai | llm | 2992 | 104 | no | อันนี้น้องกุ้งไม่มีข้อมูลเรื่องเป้าหมาย/กำหนดของทีมนะคะ ต้องรบกวนพี่สอบถามหัวหน้ |
| c22 | cloud | team_overdue | team_most_open | cloud | 112 | - | - | น้องกุ้งขออภัย คำถามข้อมูลทีมใช้ได้เฉพาะผู้จัดการหรือเจ้าของระบบ พี่ยังถามว่า "ง |
| c23 | cloud | team_today | fim_qa | php | 6466 | 120 | no | น้องกุ้งสรุปภาพรวมงานวันนี้ (11 ก.ย. 2026) ให้ค่ะพี่  - คนลงเวลา: 0 คน - ของเข้า |
| c24 | cloud | team_today | general_ai | llm | 4355 | 147 | no | ตอนนี้น้องกุ้งยังไม่มีข้อมูลสรุปงานของทีมเลยค่ะ พี่ลองถามหัวหน้างานดูนะคะ หรือถ้ |
| c25 | cloud | team_rejected | team_rejected | cloud | 136 | - | - | น้องกุ้งขออภัย คำถามข้อมูลทีมใช้ได้เฉพาะผู้จัดการหรือเจ้าของระบบ พี่ยังถามว่า "ง |
| c26 | cloud | team_rejected | general_ai | llm | 4341 | 210 | no | เรื่องนี้น้องกุ้งไม่มีข้อมูลเลยค่ะ ไม่แน่ใจว่าพี่หมายถึงงานไหนไม่ได้รับอนุมัติ ล |
| c27 | cloud | stats_rejected_month | general_ai | llm | 4142 | 189 | no | อันนี้น้องกุ้งไม่มีข้อมูลเรื่องยอดปฏิเสธใบงานเลยค่ะ ต้องขอให้พี่เช็คกับหัวหน้างา |
| c28 | cloud | stats_rejected_month | general_ai | llm | 4198 | 183 | no | เรื่องนี้น้องกุ้งยังไม่มีข้อมูลสรุปให้ดูโดยตรงเลยค่ะ ต้องขอให้พี่สอบถามหัวหน้างา |
| c29 | cloud | stats_fastest_accept | stats_fastest_accept | cloud | 122 | - | - | น้องกุ้งขออภัย คำถามข้อมูลทีมใช้ได้เฉพาะผู้จัดการหรือเจ้าของระบบ พี่ยังถามว่า "ง |
| c30 | cloud | stats_fastest_accept | general_ai | llm | 4407 | 214 | no | หมายถึงเรื่องอะไรคะพี่ ถ้าเป็นเรื่องมอบหมายงานหรือแจ้งเตือนในระบบ น้องกุ้งยังไม่ |
| c31 | cloud | stats_avg_cycle | general_ai | llm | 5204 | 208 | no | เรื่องนี้น้องกุ้งยังไม่มีข้อมูลสรุปเวลาเฉลี่ยตั้งแต่รับถึงเสร็จให้พี่เลยค่ะ 🙏 พี |
| c32 | cloud | stats_avg_cycle | general_ai | llm | 4239 | 174 | no | เรื่องนี้น้องกุ้งไม่มีข้อมูลชัดเจนค่ะ ต้องขออนุญาตให้พี่ลองถามหัวหน้างานดูนะคะ ห |
| c33 | cloud | stats_completed_month | general_ai | llm | 3275 | 152 | no | อันนี้น้องกุ้งยังไม่มีข้อมูลตรงนี้เลยค่ะ พี่ลองถามหัวหน้างานดูนะคะ หรือถ้าอยากให |
| c34 | cloud | stats_completed_month | general_ai | llm | 4965 | 154 | no | สอบถามพี่แป๊บนะคะ พี่หมายถึงเช็คสถานะใบงานไหนคะ พี่ลองพิมพ์เลขใบงาน หรือกดเมนู " |
| c35 | cloud | stats_new_today | stats_new_today | cloud | 219 | - | - | น้องกุ้งตรวจแล้ว วันนี้ไม่มีงานใหม่ในขอบเขตที่พี่ดูได้ค่ะ |
| c36 | cloud | stats_new_today | general_ai | llm | 3067 | 96 | no | เรื่องยอดของเข้าวันนี้ พี่พิมพ์ว่า "ของเข้าวันนี้" ได้เลยนะคะ น้องกุ้งจะสรุปให้ท |
| c37 | cloud | help | qa_index | php | 5 | - | - | เรียกน้องกุ้งในกลุ่ม พิมพ์แบบนี้ค่ะ แท็ก @HAT Log Decepticons เว้นวรรค แล้วตามด้ |
| c38 | cloud | help | unmatched | fallback | 6736 | 512 | yes | น้องกุ้งยังไม่เข้าใจคำถามนี้ ลองพิมพ์ว่า "AI ช่วยอะไรได้บ้าง" เพื่อดูสิ่งที่น้อง |
| c39 | cloud | my_tasks | qa_index | php | 6 | - | - | ดูงานที่ได้รับมอบหมายที่ปุ่มริชเมนู "งานของฉัน" ค่ะ ส่วนหัวหน้างานจะมอบงานใหม่ พ |
| c40 | cloud | help | unmatched | fallback | 6715 | 512 | yes | น้องกุ้งยังไม่เข้าใจคำถามนี้ ลองพิมพ์ว่า "AI ช่วยอะไรได้บ้าง" เพื่อดูสิ่งที่น้อง |
| g01 | general_th | - | general_ai | llm | 5450 | 226 | no | ใบขนท้ายศูนย์ ปกติหมายถึงใบขนสินค้าที่ลงเลขที่ลงท้ายด้วย 0 ค่ะ แต่ถ้าพี่หมายถึงค |
| g02 | general_th | - | general_ai | llm | 5734 | 249 | no | FOB (Free On Board) ผู้ขายรับผิดชอบแค่ถึงตอนของขึ้นเรือที่ท่าต้นทาง ค่าขนส่ง+ประ |
| g03 | general_th | - | general_ai | llm | 8008 | 338 | no | HS Code หาได้จากกรมศุลกากรเลยค่ะ พี่ลองเช็คได้ที่เว็บไซต์กรมศุลกากรไทย (customs. |
| g04 | general_th | - | general_ai | llm | 6946 | 342 | no | เรื่องนี้น้องกุ้งตอบให้ได้ค่ะ  📥 นำเข้า (Import) = การนำสินค้าจากต่างประเทศเข้าม |
| g05 | general_th | - | general_ai | llm | 7209 | 301 | no | การจดทะเบียนเป็นผู้ผ่านพิธีการศุลกากร (ผู้นำเข้า-ส่งออก) ต้องยื่นขอผ่านระบบ e-Cu |
| g06 | general_th | - | general_ai | llm | 7666 | 267 | no | ใช่ค่ะ ไม่เหมือนกันค่ะ  - Net Weight (น้ำหนักสุทธิ) = น้ำหนักเฉพาะตัวสินค้า ไม่ร |
| g07 | general_th | - | general_ai | llm | 3393 | 134 | no | เรื่องเงินเดือนน้องกุ้งไม่มีสิทธิ์เข้าถึงข้อมูลส่วนนี้นะคะ พี่ลองเช็คในเวปจัดการ |
| g08 | general_th | - | qa_index | php | 5 | - | - | แจ้งลาพิมพ์ในแชท LINE ได้เลยค่ะ เช่น "ลาป่วยพรุ่งนี้ 1 วัน" ระบบจะบันทึกให้ทันที |
| g09 | general_th | - | general_ai | llm | 3206 | 84 | no | น้องกุ้งค่ะพี่ ชื่อจริงก็คือชื่อนี้แหละค่ะ ไม่มีชื่อลับซ่อนไว้หรอกค่ะ 😊 |
| g10 | general_th | - | general_ai | llm | 4380 | 132 | no | อ๊ะ น้องกุ้งไม่มีข้อมูลสภาพอากาศแบบเรียลไทม์เลยค่ะ พี่ลองเช็คแอปพยากรณ์อากาศดูนะ |
| e01 | en | my_tasks | general_ai | llm | 2425 | 56 | no | You can check that from "งานของฉัน" button on the rich menu, that'll show all yo |
| e02 | en | help | general_ai | llm | 4668 | 254 | no | Nong Kung can help you with these things: report leave (e.g. "sick leave tomorro |
| e03 | en | team_most_open | general_ai | llm | 2833 | 93 | no | Sorry, Nong Kung doesn't have that info right now! For task assignments, please |
| e04 | en | my_overdue | general_ai | llm | 2681 | 124 | no | Sorry, Nong Kung doesn't have a command for checking overdue tasks right now 🙏 Y |
| e05 | en | - | general_ai | llm | 2828 | 100 | no | A customs declaration is an official document that lists details of goods being |
| e06 | en | - | general_ai | llm | 3212 | 189 | no | Sure! Here's the quick difference:  **FOB (Free On Board)** – Seller's responsib |
| e07 | en | - | general_ai | llm | 2631 | 81 | no | To request leave, just type it in chat like this: "Sick leave tomorrow, 1 day" a |
| e08 | en | - | general_ai | llm | 5982 | 305 | no | HS Code (Harmonized System Code) คือรหัสสากลที่ใช้จำแนกประเภทสินค้าเพื่อการนำเข้ |
| e09 | en | my_open | fim_qa | php | 11 | - | - | น้องกุ้งสรุปของเข้าพรุ่งนี้ให้ค่ะ 📦  📦 Daily Delivery Summary / สรุปการส่งของ 12 |
| e10 | en | help | qa_index | php | 5 | - | - | แจ้งลาพิมพ์ในแชท LINE ได้เลยค่ะ เช่น "ลาป่วยพรุ่งนี้ 1 วัน" ระบบจะบันทึกให้ทันที |

## สรุป

- เรียก LLM จริงไปแล้ว **39** ครั้ง (เพดาน 40)
- คำตอบที่ถูกตัดกลาง (truncated): **2**
- คำตอบที่ตกไปข้อความ "ยังไม่เข้าใจ": **2**
- คลาวด์เข้าเป้ารวม: **10/40**

### คลาวด์เข้าเป้ารายอินเทนต์

| intent | hit | total |
|---|---:|---:|
| help | 0 | 3 |
| my_done_today | 0 | 2 |
| my_done_week | 1 | 2 |
| my_latest_assigned | 0 | 2 |
| my_next | 1 | 2 |
| my_open | 1 | 2 |
| my_overdue | 1 | 2 |
| my_tasks | 1 | 3 |
| stats_avg_cycle | 0 | 2 |
| stats_completed_month | 0 | 2 |
| stats_fastest_accept | 1 | 2 |
| stats_new_today | 1 | 2 |
| stats_rejected_month | 0 | 2 |
| team_most_open | 0 | 2 |
| team_overdue | 0 | 2 |
| team_rejected | 1 | 2 |
| team_today | 0 | 2 |
| team_unaccepted | 1 | 2 |
| team_unassigned | 1 | 2 |

### เวลาต่อชั้น

| layer | ข้อ | avg ms | max ms |
|---|---:|---:|---:|
| cloud | 11 | 151 | 219 |
| fallback | 2 | 6726 | 6736 |
| llm | 36 | 4332 | 8008 |
| php | 11 | 594 | 6466 |

### คำถามที่คลาวด์ตอบไม่ได้ (จาก tbl_aim_ask_miss ก่อนลบทิ้ง)

| เวลา | source | resolved_by | คำถาม |
|---|---|---|---|
| 2026-09-11 05:40:42 | user | general_ai | เกินกำหนดแล้วเท่าไหร่ |
| 2026-09-11 05:40:45 | user | general_ai | วันนี้เสร็จได้กี่ใบ |
| 2026-09-11 05:40:50 | user | general_ai | ปิดงานแล้วกี่อัน |
| 2026-09-11 05:40:53 | user | general_ai | เสร็จสัปดาห์นี้มีกี่ใบ |
| 2026-09-11 05:40:57 | user | general_ai | งานถัดไปคือไรเอ่ย |
| 2026-09-11 05:41:00 | user | general_ai | เพิ่งได้งานมาตอนไหน |
| 2026-09-11 05:41:05 | user | general_ai | มีคนไม่ยอมรับงานไหม |
| 2026-09-11 05:41:10 | user | general_ai | คนไหนยุ่งที่สุดในทีม |
| 2026-09-11 05:41:13 | user | general_ai | ทีมเราเลยกำหนดไหนบ้าง |
| 2026-09-11 05:41:24 | user | general_ai | ทีมวันนี้ทำอะไรไป |
| 2026-09-11 05:41:29 | user | general_ai | ใครไม่อนุมัติงาน |
| 2026-09-11 05:41:33 | user | general_ai | เดือนนี้ปฏิเสธกี่ใบ |
| 2026-09-11 05:41:37 | user | general_ai | งานไม่ผ่านเดือนนี้เท่าไหร่ |
| 2026-09-11 05:41:42 | user | general_ai | คนไหนฉับไวที่สุดตอบรับ |
| 2026-09-11 05:41:47 | user | general_ai | เฉลี่ยนานเท่าไหร่จากรับถึงเสร็จ |
| 2026-09-11 05:41:51 | user | general_ai | ทำงานเฉลี่ยกี่วัน |
| 2026-09-11 05:41:54 | user | general_ai | เดือนนี้ปิดได้กี่ใบ |
| 2026-09-11 05:41:59 | user | general_ai | งานเสร็จสิ้นเท่าไหร่ |
| 2026-09-11 05:42:03 | user | general_ai | เข้าใหม่วันนี้เท่าไหร่ |
| 2026-09-11 05:42:09 | user | fallback | ช่วยเรื่องไหนได้บ้าง |
| 2026-09-11 05:42:16 | user | fallback | เมนูมีอะไรให้เลือก |
| 2026-09-11 05:42:22 | user | general_ai | ใบขนท้ายศูนย์คืออะไร |
| 2026-09-11 05:42:27 | user | general_ai | FOB กับ CIF ต่างยังไง |
| 2026-09-11 05:42:35 | user | general_ai | HS code เอาจากไหน |
| 2026-09-11 05:42:42 | user | general_ai | ความแตกต่างระหว่างนำเข้าส่งออก |
| 2026-09-11 05:42:49 | user | general_ai | ต้องจดทะเบียนศุลกากรตรงไหน |
| 2026-09-11 05:42:57 | user | general_ai | พีซีกับกรอสไม่เหมือนกันใช่ไหม |
| 2026-09-11 05:43:01 | user | general_ai | เงินเดือนฉันเท่าไหร่ |
| 2026-09-11 05:43:04 | user | general_ai | เธอชื่ออะไรจริง |
| 2026-09-11 05:43:08 | user | general_ai | วันนี้อากาศเป็นไง |
| 2026-09-11 05:43:11 | user | general_ai | show my tasks |
| 2026-09-11 05:43:15 | user | general_ai | what can you do |
| 2026-09-11 05:43:18 | user | general_ai | who has the most open tasks |
| 2026-09-11 05:43:21 | user | general_ai | my overdue tasks |
| 2026-09-11 05:43:24 | user | general_ai | what is a customs declaration |
| 2026-09-11 05:43:27 | user | general_ai | difference between FOB and CIF |
| 2026-09-11 05:43:29 | user | general_ai | how do I request leave |
| 2026-09-11 05:43:35 | user | general_ai | what is HS code |

