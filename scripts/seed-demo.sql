-- realtime_doctor -- scripts/seed-demo.sql
--
-- DEMO DATA ONLY. Every name, birth date, phone number and registration number
-- below is synthetic. Nothing here is PHI and nothing here came from a real
-- patient. The names are deliberately obvious demo names (김데모, 이시연,
-- 박준호, 최영자) and the phone numbers are all 010-0000-000N so that a row
-- from this file can never be mistaken for a real one.
--
-- What it seeds, all owned by the single demo clinician
-- a79fdc6c-f356-413a-b08d-206dd7e3bfeb (demo.friend@righthand-demo.com):
--
--   4 x public.patients
--   4 x public.encounters      -- 2 intake_done (one red-flagged), 1 in_consult,
--                                 1 completed
--   4 x public.intake_results  -- version 1, kiosk-shaped soap_json incl. the
--                                 transcript array, with kiosk-intake provenance
--   1 x public.sessions        -- the consult recording for the in_consult visit
--   6 x public.transcript_chunks
--   1 x public.summaries
--   1 x public.analyses
--   1 x public.dictations
--
-- Waiting list arithmetic: src/main/patients.ts filters on WAITING_STATUSES =
-- ('intake_done','in_consult'), so three of the four visits appear in the
-- Electron waiting list and the red-flagged one is pinned to the top by
-- compareWaiting(). The fourth is `completed` so the demo also shows what a
-- finished visit looks like rather than implying every visit stays open.
--
-- Idempotent: every row has a fixed literal UUID and every insert carries
-- `on conflict do nothing`, so re-running this file changes nothing. It does
-- NOT update existing rows -- to change a value, delete the row first (see the
-- commented-out cleanup block at the bottom) and re-run.
--
-- facts_fingerprint on intake_results is deliberately NOT supplied: migration
-- 0011's BEFORE INSERT trigger computes it inside the database. A
-- client-supplied fingerprint would be a claim rather than evidence.
--
-- Run as a role that can bypass RLS (service_role / the SQL editor). The
-- policies in 0001 are auth.uid()-based and would reject these rows from an
-- ordinary authenticated session.

begin;

-- ===========================================================================
-- patients
-- ===========================================================================
insert into public.patients (id, user_id, name, birth_date, registration_no, phone, created_at)
values
  ('11111111-1111-4111-8111-000000000001', 'a79fdc6c-f356-413a-b08d-206dd7e3bfeb',
   '김데모', '1958-03-12', 'DEMO-0001', '010-0000-0001', now() - interval '4 days'),
  ('11111111-1111-4111-8111-000000000002', 'a79fdc6c-f356-413a-b08d-206dd7e3bfeb',
   '이시연', '1979-11-02', 'DEMO-0002', '010-0000-0002', now() - interval '3 days'),
  ('11111111-1111-4111-8111-000000000003', 'a79fdc6c-f356-413a-b08d-206dd7e3bfeb',
   '박준호', '1990-06-25', 'DEMO-0003', '010-0000-0003', now() - interval '2 days'),
  ('11111111-1111-4111-8111-000000000004', 'a79fdc6c-f356-413a-b08d-206dd7e3bfeb',
   '최영자', '1949-01-08', 'DEMO-0004', '010-0000-0004', now() - interval '1 day')
on conflict (id) do nothing;

-- ===========================================================================
-- encounters
-- ===========================================================================
-- chief_complaint is denormalised from intake_results.soap_json.s.chief_complaint,
-- exactly as kiosk/lib/intake/result.ts does after it stores the result.
insert into public.encounters (
  id, patient_id, user_id, status, red_flag, red_flag_reason, chief_complaint,
  consent_privacy, consent_recording, consent_ai, consented_at,
  created_at, completed_at
)
values
  -- 1) Red flag, still waiting. Pinned to the top of the waiting list.
  ('22222222-2222-4222-8222-000000000001',
   '11111111-1111-4111-8111-000000000001',
   'a79fdc6c-f356-413a-b08d-206dd7e3bfeb',
   'intake_done', true, '급성 폐쇄각 녹내장 의심 (갑작스러운 우안 통증·시야 흐림·구역, 즉시 안압 확인 필요)',
   '어제 저녁부터 오른쪽 눈이 심하게 아프고 뿌옇게 보임',
   true, true, true, now() - interval '3 hours',
   now() - interval '3 hours', null),

  -- 2) Ordinary waiting visit.
  ('22222222-2222-4222-8222-000000000002',
   '11111111-1111-4111-8111-000000000002',
   'a79fdc6c-f356-413a-b08d-206dd7e3bfeb',
   'intake_done', false, null,
   '두 달 전부터 두 눈이 뻑뻑하고 이물감이 있음',
   true, true, true, now() - interval '2 hours',
   now() - interval '2 hours', null),

  -- 3) Already in the room. This one carries the recording session below.
  ('22222222-2222-4222-8222-000000000003',
   '11111111-1111-4111-8111-000000000003',
   'a79fdc6c-f356-413a-b08d-206dd7e3bfeb',
   'in_consult', false, null,
   '사흘 전부터 왼쪽 눈이 충혈되고 눈곱이 많이 낌',
   true, true, true, now() - interval '90 minutes',
   now() - interval '90 minutes', null),

  -- 4) Finished. Not in the waiting list; visible in patient history.
  ('22222222-2222-4222-8222-000000000004',
   '11111111-1111-4111-8111-000000000004',
   'a79fdc6c-f356-413a-b08d-206dd7e3bfeb',
   'completed', false, null,
   '몇 달에 걸쳐 서서히 시야가 뿌옇고 밤에 불빛이 번져 보임',
   true, true, true, now() - interval '1 day',
   now() - interval '1 day', now() - interval '1 day' + interval '35 minutes')
on conflict (id) do nothing;

-- ===========================================================================
-- intake_results
-- ===========================================================================
-- soap_json follows kiosk/lib/intake/schemas.ts soapJsonSchema exactly:
--   s{chief_complaint,hpi,pmh,medications,allergies}, o, a, p,
--   follow_up_questions[], medical_terms[], transcript[{role,text}]
-- `o` is the fixed placeholder SOAP_OBJECTIVE_PLACEHOLDER ('진찰 소견 대기')
-- and `a` carries ASSESSMENT_DRAFT_CAVEAT, both of which the kiosk sets itself
-- rather than letting the model write them.
--
-- differentials_json[].supporting_findings[].source is "#N", where N indexes
-- into soap_json.transcript (src/shared/findings.ts parseSourceIndex +
-- src/renderer/shared/patientMode.ts patientTranscriptSources). Every source
-- below points at a real patient utterance, so the Electron differential window
-- renders them as verified rather than dropping them to "근거 미확인".

-- -- 1) 김데모 -- red flag
insert into public.intake_results (
  id, encounter_id, soap_json, differentials_json, recommended_tests_json,
  version, interpretation_provenance, created_at
)
values (
  '33333333-3333-4333-8333-000000000001',
  '22222222-2222-4222-8222-000000000001',
  jsonb_build_object(
    's', jsonb_build_object(
      'chief_complaint', '어제 저녁부터 오른쪽 눈이 심하게 아프고 뿌옇게 보임',
      'hpi', '어제 저녁 무렵 갑자기 오른쪽 눈에 심한 통증이 시작되었고 같은 쪽 머리도 아픕니다. 눈앞이 뿌옇고 불빛 주위로 무지개 같은 테가 보이며, 속이 메스껍고 한 번 토했습니다. 통증은 잠을 잘 수 없을 정도이며 점점 심해지고 있습니다.',
      'pmh', '고혈압으로 약 복용 중. 안과 수술력 없음.',
      'medications', '혈압약 (아침 1회)',
      'allergies', '없음'
    ),
    'o', '진찰 소견 대기',
    'a', '갑작스러운 편측 안통, 시야 혼탁, 광원 주위 무지개 시야, 구역·구토가 함께 있어 급성 폐쇄각 녹내장을 우선 고려합니다. 급성 전포도막염, 각막부종 동반 상태도 감별이 필요합니다.

위 목록은 감별진단 후보이며 확정 진단 아님. 최종 판단은 진찰 후 의사가 합니다.',
    'p', '즉시 안압 측정(Tonometry)을 시행하고, 세극등 현미경 검사와 전방각경 검사로 전방각 폐쇄 여부를 확인할 것을 권고합니다.',
    'follow_up_questions', jsonb_build_array(
      jsonb_build_object('question', '통증이 시작될 때 어두운 곳에 계셨나요?', 'rationale', '어두운 환경의 동공 산대는 폐쇄각 녹내장 발작의 전형적 유발 요인입니다.'),
      jsonb_build_object('question', '이전에도 불빛 주위로 무지개가 보인 적이 있으신가요?', 'rationale', '간헐적 아급성 발작 병력이면 폐쇄각 쪽 가능성이 올라갑니다.'),
      jsonb_build_object('question', '최근 감기약이나 멀미약을 드신 적이 있나요?', 'rationale', '항콜린성 약물이 동공을 넓혀 발작을 유발할 수 있습니다.')
    ),
    'medical_terms', jsonb_build_array(
      jsonb_build_object('term', '안압', 'term_en', 'Intraocular pressure', 'definition', '눈 속의 압력입니다. 이 압력이 갑자기 높아지면 눈이 아프고 시야가 뿌옇게 흐려질 수 있습니다.'),
      jsonb_build_object('term', '전방각', 'term_en', 'Anterior chamber angle', 'definition', '눈 안의 물이 빠져나가는 통로입니다. 이 통로가 막히면 눈 속 압력이 빠르게 올라갑니다.'),
      jsonb_build_object('term', '무지개 시야', 'term_en', 'Halo vision', 'definition', '불빛 주위에 둥근 무지개 테가 보이는 현상으로, 각막이 부어 있을 때 흔히 나타납니다.')
    ),
    'transcript', jsonb_build_array(
      jsonb_build_object('role', 'agent', 'text', '어떤 불편함으로 오셨는지 편하게 말씀해 주세요. 언제부터인지, 어느 쪽 눈인지, 아프거나 잘 안 보이시는지 생각나는 대로 다 말씀해 주셔도 좋아요.'),
      jsonb_build_object('role', 'patient', 'text', '어제 저녁부터 오른쪽 눈이 너무 아파요. 눈앞이 뿌옇고 머리까지 지끈거립니다.'),
      jsonb_build_object('role', 'agent', 'text', '많이 힘드셨겠어요. 불빛을 볼 때 주변에 무지개 같은 테가 보이시나요?'),
      jsonb_build_object('role', 'patient', 'text', '네, 전등을 보면 동그란 무지개가 둘러싸여 보입니다.'),
      jsonb_build_object('role', 'agent', 'text', '속이 메스껍거나 토하신 적도 있으신가요?'),
      jsonb_build_object('role', 'patient', 'text', '어젯밤에 한 번 토했고 지금도 계속 울렁거립니다.')
    )
  ),
  jsonb_build_array(
    jsonb_build_object(
      'rank', 1,
      'name_kr', '급성 폐쇄각 녹내장',
      'name_en', 'Acute angle-closure glaucoma',
      'rationale', '갑작스러운 편측 안통과 무지개 시야, 구역·구토가 동반된 전형적 조합입니다.',
      'supporting_findings', jsonb_build_array(
        jsonb_build_object('finding', '어제 저녁부터 우안 통증과 시야 혼탁', 'source', '#1'),
        jsonb_build_object('finding', '불빛 주위 무지개 시야', 'source', '#3'),
        jsonb_build_object('finding', '구토와 지속되는 구역감', 'source', '#5')
      )
    ),
    jsonb_build_object(
      'rank', 2,
      'name_kr', '급성 전포도막염',
      'name_en', 'Acute anterior uveitis',
      'rationale', '편측 안통과 시야 흐림은 전포도막염에서도 나타납니다.',
      'supporting_findings', jsonb_build_array(
        jsonb_build_object('finding', '한쪽 눈에 국한된 심한 통증', 'source', '#1')
      )
    ),
    jsonb_build_object(
      'rank', 3,
      'name_kr', '각막부종',
      'name_en', 'Corneal edema',
      'rationale', '각막이 부으면 광원 주위 무지개 시야가 생깁니다.',
      'supporting_findings', jsonb_build_array(
        jsonb_build_object('finding', '전등 주위로 보이는 둥근 무지개 테', 'source', '#3')
      )
    )
  ),
  jsonb_build_array(
    jsonb_build_object('name_kr', '안압 측정', 'name_en', 'Tonometry', 'reason', '전방각 폐쇄로 인한 안압 상승을 즉시 확인해야 합니다.'),
    jsonb_build_object('name_kr', '세극등 현미경 검사', 'name_en', 'Slit-lamp examination', 'reason', '각막부종과 전방 염증 소견을 확인합니다.'),
    jsonb_build_object('name_kr', '전방각경 검사', 'name_en', 'Gonioscopy', 'reason', '전방각의 개방 여부를 직접 관찰합니다.')
  ),
  1,
  jsonb_build_object(
    'engine', 'kiosk-intake', 'provider', 'gemini', 'model', 'gemini-2.5-flash',
    'promptVersion', 1, 'schemaVersion', 1,
    'generatedAt', to_char(now() - interval '3 hours', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
  ),
  now() - interval '3 hours'
)
on conflict (id) do nothing;

-- -- 2) 이시연 -- dry eye
insert into public.intake_results (
  id, encounter_id, soap_json, differentials_json, recommended_tests_json,
  version, interpretation_provenance, created_at
)
values (
  '33333333-3333-4333-8333-000000000002',
  '22222222-2222-4222-8222-000000000002',
  jsonb_build_object(
    's', jsonb_build_object(
      'chief_complaint', '두 달 전부터 두 눈이 뻑뻑하고 이물감이 있음',
      'hpi', '두 달 전부터 양쪽 눈이 뻑뻑하고 모래알이 들어간 듯한 느낌이 있습니다. 오후로 갈수록 심해지고, 하루 종일 모니터를 보는 사무직입니다. 아침에는 덜하고 인공눈물을 넣으면 잠시 편해집니다.',
      'pmh', '없음',
      'medications', '시판 인공눈물 (하루 2~3회)',
      'allergies', '없음'
    ),
    'o', '진찰 소견 대기',
    'a', '장시간 화면 작업과 관련된 건성안을 우선 고려합니다. 마이봄샘 기능장애와 알레르기결막염도 함께 감별합니다.

위 목록은 감별진단 후보이며 확정 진단 아님. 최종 판단은 진찰 후 의사가 합니다.',
    'p', '눈물막 파괴 시간 검사와 쉬르머 검사로 눈물 분비를 확인하고, 세극등으로 마이봄샘 상태를 관찰할 것을 권고합니다.',
    'follow_up_questions', jsonb_build_array(
      jsonb_build_object('question', '아침에 눈꺼풀이 들러붙거나 무거운 느낌이 있나요?', 'rationale', '마이봄샘 기능장애를 시사하는 소견입니다.'),
      jsonb_build_object('question', '가려움이 뻑뻑함보다 더 심한 편인가요?', 'rationale', '가려움이 우세하면 알레르기결막염 쪽으로 기웁니다.'),
      jsonb_build_object('question', '콘택트렌즈를 착용하시나요?', 'rationale', '렌즈 착용은 눈물막을 불안정하게 만듭니다.')
    ),
    'medical_terms', jsonb_build_array(
      jsonb_build_object('term', '건성안', 'term_en', 'Dry eye disease', 'definition', '눈물이 부족하거나 빨리 마르는 상태로, 눈이 뻑뻑하고 모래가 들어간 듯한 느낌이 듭니다.'),
      jsonb_build_object('term', '마이봄샘', 'term_en', 'Meibomian gland', 'definition', '눈꺼풀 가장자리에서 기름을 내보내는 작은 샘입니다. 막히면 눈물이 금방 말라 버립니다.'),
      jsonb_build_object('term', '눈물막 파괴 시간', 'term_en', 'Tear break-up time', 'definition', '눈을 깜빡인 뒤 눈물층이 갈라지기까지 걸리는 시간으로, 짧을수록 눈이 잘 마릅니다.')
    ),
    'transcript', jsonb_build_array(
      jsonb_build_object('role', 'agent', 'text', '어떤 불편함으로 오셨는지 편하게 말씀해 주세요. 언제부터인지, 어느 쪽 눈인지 생각나는 대로 말씀해 주셔도 좋아요.'),
      jsonb_build_object('role', 'patient', 'text', '두 달쯤 전부터 양쪽 눈이 뻑뻑하고 모래가 들어간 것 같아요.'),
      jsonb_build_object('role', 'agent', 'text', '하루 중 특히 언제 더 불편하신가요?'),
      jsonb_build_object('role', 'patient', 'text', '오후에 심해집니다. 사무실에서 하루 종일 모니터를 봅니다.'),
      jsonb_build_object('role', 'agent', 'text', '지금 사용하시는 안약이 있으신가요?'),
      jsonb_build_object('role', 'patient', 'text', '약국에서 산 인공눈물을 하루 두세 번 넣고 있어요. 넣으면 잠깐 편합니다.')
    )
  ),
  jsonb_build_array(
    jsonb_build_object(
      'rank', 1,
      'name_kr', '건성안',
      'name_en', 'Dry eye disease',
      'rationale', '양안의 이물감과 오후 악화, 인공눈물에 일시적으로 호전되는 경과가 전형적입니다.',
      'supporting_findings', jsonb_build_array(
        jsonb_build_object('finding', '양안의 뻑뻑함과 모래알 같은 이물감', 'source', '#1'),
        jsonb_build_object('finding', '인공눈물 점안 후 일시적 호전', 'source', '#5')
      )
    ),
    jsonb_build_object(
      'rank', 2,
      'name_kr', '마이봄샘 기능장애',
      'name_en', 'Meibomian gland dysfunction',
      'rationale', '눈물의 기름층 부족은 같은 증상을 만들며 건성안과 흔히 동반됩니다.',
      'supporting_findings', jsonb_build_array(
        jsonb_build_object('finding', '두 달간 지속된 양안 이물감', 'source', '#1')
      )
    ),
    jsonb_build_object(
      'rank', 3,
      'name_kr', '영상단말기 증후군',
      'name_en', 'Computer vision syndrome',
      'rationale', '장시간 화면 작업으로 깜빡임이 줄어 오후에 증상이 악화됩니다.',
      'supporting_findings', jsonb_build_array(
        jsonb_build_object('finding', '하루 종일 모니터 작업 후 오후 악화', 'source', '#3')
      )
    )
  ),
  jsonb_build_array(
    jsonb_build_object('name_kr', '눈물막 파괴 시간 검사', 'name_en', 'Tear break-up time test', 'reason', '눈물층의 안정성을 확인합니다.'),
    jsonb_build_object('name_kr', '쉬르머 검사', 'name_en', 'Schirmer test', 'reason', '눈물 분비량을 정량적으로 측정합니다.'),
    jsonb_build_object('name_kr', '세극등 현미경 검사', 'name_en', 'Slit-lamp examination', 'reason', '마이봄샘 개구부와 안구 표면 상태를 관찰합니다.')
  ),
  1,
  jsonb_build_object(
    'engine', 'kiosk-intake', 'provider', 'gemini', 'model', 'gemini-2.5-flash',
    'promptVersion', 1, 'schemaVersion', 1,
    'generatedAt', to_char(now() - interval '2 hours', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
  ),
  now() - interval '2 hours'
)
on conflict (id) do nothing;

-- -- 3) 박준호 -- conjunctivitis, currently in the room
insert into public.intake_results (
  id, encounter_id, soap_json, differentials_json, recommended_tests_json,
  version, interpretation_provenance, created_at
)
values (
  '33333333-3333-4333-8333-000000000003',
  '22222222-2222-4222-8222-000000000003',
  jsonb_build_object(
    's', jsonb_build_object(
      'chief_complaint', '사흘 전부터 왼쪽 눈이 충혈되고 눈곱이 많이 낌',
      'hpi', '사흘 전 아침부터 왼쪽 눈이 빨개지고 눈곱이 많이 낍니다. 아침에 눈꺼풀이 붙어 있을 정도이며 어제부터는 오른쪽 눈도 조금 빨개졌습니다. 시력 저하나 심한 통증은 없습니다. 같은 회사 동료도 비슷한 증상이 있었다고 합니다.',
      'pmh', '없음',
      'medications', '없음',
      'allergies', '없음'
    ),
    'o', '진찰 소견 대기',
    'a', '단기간에 반대쪽 눈으로 번진 충혈과 분비물, 접촉력이 있어 감염성 결막염을 우선 고려합니다. 알레르기결막염과 안검염도 감별합니다.

위 목록은 감별진단 후보이며 확정 진단 아님. 최종 판단은 진찰 후 의사가 합니다.',
    'p', '세극등 현미경 검사로 결막과 각막을 관찰하고, 필요 시 결막 분비물 도말 검사를 권고합니다.',
    'follow_up_questions', jsonb_build_array(
      jsonb_build_object('question', '눈곱이 노랗고 끈적한가요, 맑고 묽은가요?', 'rationale', '분비물 성상이 세균성과 바이러스성을 나누는 단서입니다.'),
      jsonb_build_object('question', '귀 앞쪽에 만져지는 멍울이 있으신가요?', 'rationale', '이개전 림프절 종대는 바이러스결막염을 시사합니다.'),
      jsonb_build_object('question', '최근 감기 증상이 있었나요?', 'rationale', '선행 상기도 감염은 유행각결막염과 흔히 동반됩니다.')
    ),
    'medical_terms', jsonb_build_array(
      jsonb_build_object('term', '결막염', 'term_en', 'Conjunctivitis', 'definition', '흰자위를 덮는 얇은 막에 염증이 생긴 상태로, 눈이 빨개지고 눈곱이 늘어납니다.'),
      jsonb_build_object('term', '이개전 림프절', 'term_en', 'Preauricular lymph node', 'definition', '귀 앞쪽에 있는 작은 림프절입니다. 바이러스 눈병이 있으면 붓고 만졌을 때 아플 수 있습니다.'),
      jsonb_build_object('term', '분비물 도말 검사', 'term_en', 'Conjunctival smear', 'definition', '눈곱을 살짝 묻혀 현미경으로 보는 검사로, 어떤 원인균인지 가늠하는 데 씁니다.')
    ),
    'transcript', jsonb_build_array(
      jsonb_build_object('role', 'agent', 'text', '어떤 불편함으로 오셨는지 편하게 말씀해 주세요.'),
      jsonb_build_object('role', 'patient', 'text', '사흘 전부터 왼쪽 눈이 빨개지고 눈곱이 많이 낍니다.'),
      jsonb_build_object('role', 'agent', 'text', '오른쪽 눈은 괜찮으신가요?'),
      jsonb_build_object('role', 'patient', 'text', '어제부터 오른쪽도 조금 빨개졌어요. 아침에는 눈꺼풀이 붙어 있었습니다.'),
      jsonb_build_object('role', 'agent', 'text', '주변에 비슷한 증상을 겪은 분이 계신가요?'),
      jsonb_build_object('role', 'patient', 'text', '회사 동료도 지난주에 눈병에 걸렸다고 했어요.')
    )
  ),
  jsonb_build_array(
    jsonb_build_object(
      'rank', 1,
      'name_kr', '바이러스결막염',
      'name_en', 'Viral conjunctivitis',
      'rationale', '한쪽에서 시작해 반대쪽으로 번지고 접촉력이 뚜렷합니다.',
      'supporting_findings', jsonb_build_array(
        jsonb_build_object('finding', '사흘 전 좌안에서 시작된 충혈과 분비물', 'source', '#1'),
        jsonb_build_object('finding', '동료의 유사한 눈병 접촉력', 'source', '#5')
      )
    ),
    jsonb_build_object(
      'rank', 2,
      'name_kr', '세균결막염',
      'name_en', 'Bacterial conjunctivitis',
      'rationale', '아침에 눈꺼풀이 붙을 정도의 분비물은 세균성에서도 흔합니다.',
      'supporting_findings', jsonb_build_array(
        jsonb_build_object('finding', '아침에 눈꺼풀이 붙을 만큼 많은 눈곱', 'source', '#3')
      )
    ),
    jsonb_build_object(
      'rank', 3,
      'name_kr', '알레르기결막염',
      'name_en', 'Allergic conjunctivitis',
      'rationale', '양안 충혈이라는 점에서 남겨두지만, 가려움 호소가 없어 우선순위는 낮습니다.',
      'supporting_findings', jsonb_build_array(
        jsonb_build_object('finding', '양안으로 확대된 충혈', 'source', '#3')
      )
    )
  ),
  jsonb_build_array(
    jsonb_build_object('name_kr', '세극등 현미경 검사', 'name_en', 'Slit-lamp examination', 'reason', '결막 여포와 각막 침범 여부를 확인합니다.'),
    jsonb_build_object('name_kr', '결막 분비물 도말 검사', 'name_en', 'Conjunctival smear', 'reason', '세균성과 바이러스성을 구분하는 데 도움이 됩니다.')
  ),
  1,
  jsonb_build_object(
    'engine', 'kiosk-intake', 'provider', 'gemini', 'model', 'gemini-2.5-flash',
    'promptVersion', 1, 'schemaVersion', 1,
    'generatedAt', to_char(now() - interval '90 minutes', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
  ),
  now() - interval '90 minutes'
)
on conflict (id) do nothing;

-- -- 4) 최영자 -- cataract, visit already completed
insert into public.intake_results (
  id, encounter_id, soap_json, differentials_json, recommended_tests_json,
  version, interpretation_provenance, created_at
)
values (
  '33333333-3333-4333-8333-000000000004',
  '22222222-2222-4222-8222-000000000004',
  jsonb_build_object(
    's', jsonb_build_object(
      'chief_complaint', '몇 달에 걸쳐 서서히 시야가 뿌옇고 밤에 불빛이 번져 보임',
      'hpi', '반년쯤 전부터 양쪽 눈이 서서히 뿌옇게 보입니다. 밤에 마주 오는 차 불빛이 크게 번져 보여 야간 운전을 그만두었습니다. 통증이나 충혈은 없고, 안경 도수를 바꿔도 잘 보이지 않습니다.',
      'pmh', '당뇨병 10년, 경구 혈당강하제 복용 중',
      'medications', '경구 혈당강하제 (하루 2회)',
      'allergies', '없음'
    ),
    'o', '진찰 소견 대기',
    'a', '수년에 걸친 서서한 양안 시력 저하와 야간 눈부심으로 백내장을 우선 고려합니다. 당뇨병력이 길어 당뇨망막병증 동반 여부도 반드시 확인해야 합니다.

위 목록은 감별진단 후보이며 확정 진단 아님. 최종 판단은 진찰 후 의사가 합니다.',
    'p', '세극등 현미경으로 수정체 혼탁 정도를 확인하고, 산동 후 안저검사로 망막 상태를 함께 평가할 것을 권고합니다.',
    'follow_up_questions', jsonb_build_array(
      jsonb_build_object('question', '가까운 글씨가 예전보다 잘 보이게 된 적이 있나요?', 'rationale', '핵백내장 초기의 근시화를 확인하는 질문입니다.'),
      jsonb_build_object('question', '최근 혈당 조절은 어떠셨나요?', 'rationale', '혈당 변동은 굴절 변화와 망막병증 진행 모두에 관여합니다.'),
      jsonb_build_object('question', '시야 한쪽이 가려 보이는 부분이 있나요?', 'rationale', '망막 병변에 의한 시야 결손을 감별합니다.')
    ),
    'medical_terms', jsonb_build_array(
      jsonb_build_object('term', '백내장', 'term_en', 'Cataract', 'definition', '눈 속 렌즈가 뿌옇게 흐려지는 상태로, 안개가 낀 것처럼 보이고 불빛이 번져 보입니다.'),
      jsonb_build_object('term', '당뇨망막병증', 'term_en', 'Diabetic retinopathy', 'definition', '오랜 당뇨로 눈 안쪽 망막의 혈관이 상하는 병입니다. 초기에는 증상이 거의 없습니다.'),
      jsonb_build_object('term', '안저검사', 'term_en', 'Fundus examination', 'definition', '눈동자를 넓히는 약을 넣고 눈 안쪽을 들여다보는 검사입니다.')
    ),
    'transcript', jsonb_build_array(
      jsonb_build_object('role', 'agent', 'text', '어떤 불편함으로 오셨는지 편하게 말씀해 주세요.'),
      jsonb_build_object('role', 'patient', 'text', '반년쯤 전부터 두 눈이 안개 낀 것처럼 뿌옇게 보입니다.'),
      jsonb_build_object('role', 'agent', 'text', '밤에 불빛을 볼 때는 어떠신가요?'),
      jsonb_build_object('role', 'patient', 'text', '밤에 차 불빛이 크게 번져서 이제 야간 운전은 안 합니다.'),
      jsonb_build_object('role', 'agent', 'text', '앓고 계신 병이나 드시는 약이 있으신가요?'),
      jsonb_build_object('role', 'patient', 'text', '당뇨가 십 년 됐고 혈당약을 하루 두 번 먹습니다.')
    )
  ),
  jsonb_build_array(
    jsonb_build_object(
      'rank', 1,
      'name_kr', '백내장',
      'name_en', 'Cataract',
      'rationale', '서서히 진행한 양안 시야 혼탁과 야간 눈부심이 전형적입니다.',
      'supporting_findings', jsonb_build_array(
        jsonb_build_object('finding', '반년에 걸친 양안의 안개 낀 듯한 시야', 'source', '#1'),
        jsonb_build_object('finding', '야간 불빛 번짐으로 야간 운전 중단', 'source', '#3')
      )
    ),
    jsonb_build_object(
      'rank', 2,
      'name_kr', '당뇨망막병증',
      'name_en', 'Diabetic retinopathy',
      'rationale', '10년 당뇨병력은 무증상 망막병증의 유력한 배경입니다.',
      'supporting_findings', jsonb_build_array(
        jsonb_build_object('finding', '10년간의 당뇨 병력과 경구 혈당강하제 복용', 'source', '#5')
      )
    ),
    jsonb_build_object(
      'rank', 3,
      'name_kr', '굴절이상 변화',
      'name_en', 'Refractive error change',
      'rationale', '혈당 변동에 따른 굴절 변화도 시야 흐림을 만들 수 있습니다.',
      'supporting_findings', jsonb_build_array(
        jsonb_build_object('finding', '점진적으로 나빠진 양안 시력', 'source', '#1')
      )
    )
  ),
  jsonb_build_array(
    jsonb_build_object('name_kr', '세극등 현미경 검사', 'name_en', 'Slit-lamp examination', 'reason', '수정체 혼탁의 위치와 정도를 확인합니다.'),
    jsonb_build_object('name_kr', '산동 안저검사', 'name_en', 'Dilated fundus examination', 'reason', '당뇨망막병증 동반 여부를 확인합니다.'),
    jsonb_build_object('name_kr', '굴절검사', 'name_en', 'Refraction test', 'reason', '교정시력으로 회복 가능한 부분을 가려냅니다.')
  ),
  1,
  jsonb_build_object(
    'engine', 'kiosk-intake', 'provider', 'gemini', 'model', 'gemini-2.5-flash',
    'promptVersion', 1, 'schemaVersion', 1,
    'generatedAt', to_char(now() - interval '1 day', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
  ),
  now() - interval '1 day'
)
on conflict (id) do nothing;

-- ===========================================================================
-- Consult session for encounter 3 (박준호, in_consult)
-- ===========================================================================
-- Gives the doctor-side screens (transcript / summary / analysis / dictation)
-- something to render instead of an empty state.
insert into public.sessions (
  id, user_id, encounter_id, started_at, ended_at, transcribe_provider,
  audio_path, title, color, pinned, pinned_at, created_at
)
values (
  '44444444-4444-4444-8444-000000000001',
  'a79fdc6c-f356-413a-b08d-206dd7e3bfeb',
  '22222222-2222-4222-8222-000000000003',
  now() - interval '75 minutes',
  now() - interval '66 minutes',
  'clova',
  null,
  '데모 진료 - 박준호',
  'blue',
  false,
  null,
  now() - interval '75 minutes'
)
on conflict (id) do nothing;

-- transcript_chunks.speaker is constrained to ('doctor','patient','unknown').
-- chunk_id is the app-generated id the transcript window addresses rows by; the
-- analyses row below cites exactly these values in supportingFindings.utteranceId.
insert into public.transcript_chunks (
  id, session_id, user_id, chunk_id, speaker, text, timestamp_ms, audio_path, created_at
)
values
  ('55555555-5555-4555-8555-000000000001', '44444444-4444-4444-8444-000000000001',
   'a79fdc6c-f356-413a-b08d-206dd7e3bfeb', 'demo-chunk-001', 'doctor',
   '박준호 님, 왼쪽 눈이 사흘 전부터 빨개지셨다고요. 지금 통증은 어느 정도세요?',
   0, null, now() - interval '75 minutes'),
  ('55555555-5555-4555-8555-000000000002', '44444444-4444-4444-8444-000000000001',
   'a79fdc6c-f356-413a-b08d-206dd7e3bfeb', 'demo-chunk-002', 'patient',
   '아프다기보다는 뻑뻑하고 눈곱이 계속 낍니다. 아침에는 눈이 잘 안 떠져요.',
   12000, null, now() - interval '75 minutes'),
  ('55555555-5555-4555-8555-000000000003', '44444444-4444-4444-8444-000000000001',
   'a79fdc6c-f356-413a-b08d-206dd7e3bfeb', 'demo-chunk-003', 'doctor',
   '눈곱 색깔은 어떻습니까? 노랗고 끈적한가요, 아니면 맑고 묽은가요?',
   26000, null, now() - interval '74 minutes'),
  ('55555555-5555-4555-8555-000000000004', '44444444-4444-4444-8444-000000000001',
   'a79fdc6c-f356-413a-b08d-206dd7e3bfeb', 'demo-chunk-004', 'patient',
   '맑고 묽은 편이에요. 그리고 귀 앞쪽을 누르면 좀 아픕니다.',
   38000, null, now() - interval '74 minutes'),
  ('55555555-5555-4555-8555-000000000005', '44444444-4444-4444-8444-000000000001',
   'a79fdc6c-f356-413a-b08d-206dd7e3bfeb', 'demo-chunk-005', 'doctor',
   '시력이 흐려지거나 빛이 유난히 부신 증상은 없으셨나요?',
   54000, null, now() - interval '73 minutes'),
  ('55555555-5555-4555-8555-000000000006', '44444444-4444-4444-8444-000000000001',
   'a79fdc6c-f356-413a-b08d-206dd7e3bfeb', 'demo-chunk-006', 'patient',
   '시력은 그대로입니다. 빛이 부시지도 않아요.',
   67000, null, now() - interval '73 minutes')
on conflict (id) do nothing;

-- analyses: one row per session (session_id is the PK). Keys are camelCase
-- because src/main/sessions.ts writes the AnalysisResult object verbatim into
-- these jsonb columns and reads it back the same way.
insert into public.analyses (
  session_id, user_id, differential_diagnoses, medical_terms,
  suggested_questions, red_flags, interpretation_provenance, updated_at, created_at
)
values (
  '44444444-4444-4444-8444-000000000001',
  'a79fdc6c-f356-413a-b08d-206dd7e3bfeb',
  jsonb_build_array(
    jsonb_build_object(
      'name', '유행각결막염',
      'nameEn', 'Epidemic keratoconjunctivitis',
      'reasoning', '묽은 분비물과 이개전 림프절 압통이 함께 있어 아데노바이러스에 의한 유행각결막염을 우선 고려합니다.',
      'supportingFindings', jsonb_build_array(
        jsonb_build_object(
          'finding', '맑고 묽은 분비물',
          'source', '#3',
          'utteranceId', 'demo-chunk-004',
          'quote', '맑고 묽은 편이에요. 그리고 귀 앞쪽을 누르면 좀 아픕니다.'
        )
      )
    ),
    jsonb_build_object(
      'name', '세균결막염',
      'nameEn', 'Bacterial conjunctivitis',
      'reasoning', '아침에 눈이 잘 떠지지 않을 정도의 분비물은 세균성에서도 흔한 소견입니다.',
      'supportingFindings', jsonb_build_array(
        jsonb_build_object(
          'finding', '아침에 눈이 잘 떠지지 않을 만큼의 눈곱',
          'source', '#1',
          'utteranceId', 'demo-chunk-002',
          'quote', '아프다기보다는 뻑뻑하고 눈곱이 계속 낍니다. 아침에는 눈이 잘 안 떠져요.'
        )
      )
    )
  ),
  jsonb_build_array(
    jsonb_build_object('term', '이개전 림프절', 'termEn', 'Preauricular lymph node',
                       'definition', '귀 앞쪽의 작은 림프절입니다. 바이러스결막염에서 붓고 눌렀을 때 아플 수 있습니다.'),
    jsonb_build_object('term', '각막상피하 혼탁', 'termEn', 'Subepithelial infiltrate',
                       'definition', '유행각결막염 회복기에 각막 표면 아래 생기는 뿌연 점으로, 눈부심의 원인이 됩니다.')
  ),
  jsonb_build_array(
    jsonb_build_object('question', '최근 감기를 앓으셨나요?', 'rationale', '선행 상기도 감염은 아데노바이러스 감염을 시사합니다.'),
    jsonb_build_object('question', '가족이나 동료 중 같은 증상을 보인 분이 있나요?', 'rationale', '전염력이 높아 접촉자 관리가 필요합니다.')
  ),
  '[]'::jsonb,
  jsonb_build_object(
    'engine', 'desktop-live-analysis', 'provider', 'gemini', 'model', 'gemini-2.5-flash',
    'promptVersion', 1, 'schemaVersion', 1,
    'generatedAt', to_char(now() - interval '70 minutes', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
  ),
  now() - interval '70 minutes',
  now() - interval '73 minutes'
)
on conflict (session_id) do nothing;

insert into public.summaries (
  id, session_id, user_id, chief_complaint, history_of_present_illness,
  pertinent_findings, investigations_mentioned, clinical_impression, plan,
  generated_at, created_at
)
values (
  '66666666-6666-4666-8666-000000000001',
  '44444444-4444-4444-8444-000000000001',
  'a79fdc6c-f356-413a-b08d-206dd7e3bfeb',
  '사흘 전부터 좌안 충혈과 분비물',
  '사흘 전 좌안에서 시작해 어제 우안으로 확대되었습니다. 분비물은 맑고 묽으며 아침에 눈꺼풀이 붙습니다. 시력 저하와 눈부심은 없습니다. 직장 동료의 유사 증상 접촉력이 있습니다.',
  '귀 앞쪽 압통 호소. 시력 변화 및 눈부심 없음.',
  '세극등 현미경 검사, 결막 분비물 도말 검사',
  '접촉력과 분비물 성상을 고려할 때 바이러스결막염 가능성이 높습니다. 확정 진단은 진찰 소견에 따릅니다.',
  '인공눈물과 냉찜질로 대증 치료하고, 전염 예방 교육 후 일주일 뒤 재평가합니다.',
  now() - interval '68 minutes',
  now() - interval '68 minutes'
)
on conflict (id) do nothing;

-- dictations.template is constrained to ('soap','apso','hp','narrative').
insert into public.dictations (
  id, session_id, user_id, template, sections, generated_at, created_at
)
values (
  '77777777-7777-4777-8777-000000000001',
  '44444444-4444-4444-8444-000000000001',
  'a79fdc6c-f356-413a-b08d-206dd7e3bfeb',
  'soap',
  jsonb_build_array(
    jsonb_build_object('heading', 'Subjective',
      'body', '사흘 전부터 좌안 충혈과 분비물. 어제부터 우안으로 확대. 분비물은 맑고 묽으며 기상 시 눈꺼풀이 붙음. 시력 저하 및 눈부심 없음. 직장 내 유사 증상 접촉력 있음.'),
    jsonb_build_object('heading', 'Objective',
      'body', '좌안 우세의 양안 결막 충혈. 이개전 림프절 압통 호소. 세극등 소견은 진찰 후 기재 예정.'),
    jsonb_build_object('heading', 'Assessment',
      'body', '바이러스결막염 의증. 세균결막염 감별 요함. 확정 진단 아님.'),
    jsonb_build_object('heading', 'Plan',
      'body', '인공눈물 및 냉찜질. 손 위생과 수건 분리 교육. 일주일 뒤 재평가, 시력 저하나 눈부심 발생 시 즉시 내원.')
  ),
  now() - interval '66 minutes',
  now() - interval '66 minutes'
)
on conflict (id) do nothing;

commit;

-- ===========================================================================
-- Cleanup -- uncomment and run to remove exactly the rows seeded above.
-- ===========================================================================
-- Children before parents. The FKs are all `on delete cascade`, so deleting the
-- patients alone would be enough for encounters/intake_results, but the deletes
-- are spelled out so this block removes these rows and nothing else.
--
-- begin;
--
-- delete from public.dictations where id = '77777777-7777-4777-8777-000000000001';
-- delete from public.summaries  where id = '66666666-6666-4666-8666-000000000001';
-- delete from public.analyses   where session_id = '44444444-4444-4444-8444-000000000001';
-- delete from public.transcript_chunks where id in (
--   '55555555-5555-4555-8555-000000000001',
--   '55555555-5555-4555-8555-000000000002',
--   '55555555-5555-4555-8555-000000000003',
--   '55555555-5555-4555-8555-000000000004',
--   '55555555-5555-4555-8555-000000000005',
--   '55555555-5555-4555-8555-000000000006'
-- );
-- delete from public.sessions where id = '44444444-4444-4444-8444-000000000001';
--
-- delete from public.intake_results where id in (
--   '33333333-3333-4333-8333-000000000001',
--   '33333333-3333-4333-8333-000000000002',
--   '33333333-3333-4333-8333-000000000003',
--   '33333333-3333-4333-8333-000000000004'
-- );
-- delete from public.encounters where id in (
--   '22222222-2222-4222-8222-000000000001',
--   '22222222-2222-4222-8222-000000000002',
--   '22222222-2222-4222-8222-000000000003',
--   '22222222-2222-4222-8222-000000000004'
-- );
-- delete from public.patients where id in (
--   '11111111-1111-4111-8111-000000000001',
--   '11111111-1111-4111-8111-000000000002',
--   '11111111-1111-4111-8111-000000000003',
--   '11111111-1111-4111-8111-000000000004'
-- );
--
-- commit;
