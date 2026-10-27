-- Re-label no-PR cloud-agent runs filed as API errors before the verdict fix (#592).
-- Categories from classifyNoPrSummary (packages/server/supabase/functions/_shared/cloud-agent-no-pr.ts)
-- run on each attempt's stored summary, 2026-10-23. Rows with no verdict keep their category.
update public.fix_attempts
   set failure_category = 'needs_human',
       error = 'Agent says this needs a person: ' || regexp_replace(error, '^Cloud agent finished without opening a pull request\. Its notes: ', '')
 where error like 'Cloud agent finished without opening a pull request.%'
   and failure_category in ('cursor_api_error', 'unknown')
   and id in ('7b89046e-8de6-4a12-96a8-01c2f5724c1f', 'c6d18604-fe84-4875-9a13-9e6336c64a9d', '8d438690-5d1f-4b90-a41e-89017982a12b', '1d225fb6-70cf-41ba-a1f2-5680aaeeb919', 'ac229174-3177-4f54-b5ba-26f4a2e96ef7', 'c5ef06cc-3e30-40eb-bd78-1f5679cc70fc', '0d4da770-aff9-4536-8c17-4912d9216bc1', 'ef62df13-5a65-4cd4-a5ca-5b5bc63d6434', '2c564f4a-74fb-4c62-a87f-685447f2940f', '567ab30d-ca5c-4361-a80f-8a63f3189667', '146db701-1cdc-4e41-9f4e-8bb93109e998', 'a4ad1d4f-7de2-4e39-a984-10e0b02a4dca', '16144e51-0659-4a7b-84bb-9d5b0ce1cfd5', 'a2a477e6-9213-40b9-93af-ed11cff702aa', 'f48a44fe-bf67-4cd7-a934-fdc8cd5dff31', 'f3dfdb4a-e750-474b-bcc8-cad327b0f2e5', 'e220916f-3c7b-418a-864a-6f4c4ffa4b33', '7cc23f90-37d8-48de-8c9d-f3780e12b6f7', '054fb6c0-c4b0-4edc-9fc4-47bb9e14419e', 'a7de1dc6-3f75-444e-952b-ed02a092deda', 'b7cda7fb-3dc0-4f21-b74c-95526646818b', 'ece22f81-efc6-440c-b35c-9d47b91eb406', '45dd152b-02fe-474f-863a-09dd83d60069', '7852a2fe-e5f8-4cf2-ac4e-7e347f691a09', '528bc238-5e11-44fa-90c1-105322ba9fa5', '4bf17a45-d8fc-4e28-9475-c5e3caed1d25', 'c4eb8670-8ecb-4a15-9de5-f291bb02791b', '0ea52838-ad33-431a-9b7d-7205e1744079', '57dd094d-d6d7-43a8-b31c-4776aca3bd19', '018191f2-ef1b-4eb0-a08f-ffa95eee4eb3', '8aa17a59-dc22-49a0-a3ba-82f9212c1fb8', 'cca11330-e9cb-4cff-b5b0-f224a136b7db');

update public.fix_attempts
   set failure_category = 'wrong_repo',
       error = 'Agent says the code is in another repo: ' || regexp_replace(error, '^Cloud agent finished without opening a pull request\. Its notes: ', '')
 where error like 'Cloud agent finished without opening a pull request.%'
   and failure_category in ('cursor_api_error', 'unknown')
   and id in ('65272553-2ba7-4af1-ae3c-1dd660906c51', '1a155209-c761-4d3e-bff5-71b355a02602', 'c2c0a511-cf75-415b-a4d4-2c0bc5d389dd');

update public.fix_attempts
   set failure_category = 'not_actionable',
       error = 'Agent found nothing it can tie to code: ' || regexp_replace(error, '^Cloud agent finished without opening a pull request\. Its notes: ', '')
 where error like 'Cloud agent finished without opening a pull request.%'
   and failure_category in ('cursor_api_error', 'unknown')
   and id in ('e6f662cd-7f09-40bf-aae3-5af9d262788a');

update public.fix_attempts
   set failure_category = 'already_fixed',
       error = 'Agent found nothing to change: ' || regexp_replace(error, '^Cloud agent finished without opening a pull request\. Its notes: ', '')
 where error like 'Cloud agent finished without opening a pull request.%'
   and failure_category in ('cursor_api_error', 'unknown')
   and id in ('0cfdc699-9a8d-4a52-b5b0-2f75445533c1', 'cd7b3d76-526a-434e-bb36-57e9b5cbfb6f');

-- The dispatch job carries the same error line (Stopped dispatches on /fixes).
update public.fix_dispatch_jobs j
   set error = fa.error
  from public.fix_attempts fa
 where j.fix_attempt_id = fa.id
   and j.error like 'Cloud agent finished without opening a pull request.%'
   and fa.error not like 'Cloud agent finished without opening a pull request.%'
   and fa.id in ('7b89046e-8de6-4a12-96a8-01c2f5724c1f', 'c6d18604-fe84-4875-9a13-9e6336c64a9d', '8d438690-5d1f-4b90-a41e-89017982a12b', '1d225fb6-70cf-41ba-a1f2-5680aaeeb919', 'ac229174-3177-4f54-b5ba-26f4a2e96ef7', 'c5ef06cc-3e30-40eb-bd78-1f5679cc70fc', '0d4da770-aff9-4536-8c17-4912d9216bc1', 'ef62df13-5a65-4cd4-a5ca-5b5bc63d6434', '2c564f4a-74fb-4c62-a87f-685447f2940f', '567ab30d-ca5c-4361-a80f-8a63f3189667', '146db701-1cdc-4e41-9f4e-8bb93109e998', 'a4ad1d4f-7de2-4e39-a984-10e0b02a4dca', '16144e51-0659-4a7b-84bb-9d5b0ce1cfd5', 'a2a477e6-9213-40b9-93af-ed11cff702aa', 'f48a44fe-bf67-4cd7-a934-fdc8cd5dff31', 'f3dfdb4a-e750-474b-bcc8-cad327b0f2e5', 'e220916f-3c7b-418a-864a-6f4c4ffa4b33', '7cc23f90-37d8-48de-8c9d-f3780e12b6f7', '054fb6c0-c4b0-4edc-9fc4-47bb9e14419e', 'a7de1dc6-3f75-444e-952b-ed02a092deda', 'b7cda7fb-3dc0-4f21-b74c-95526646818b', 'ece22f81-efc6-440c-b35c-9d47b91eb406', '45dd152b-02fe-474f-863a-09dd83d60069', '7852a2fe-e5f8-4cf2-ac4e-7e347f691a09', '528bc238-5e11-44fa-90c1-105322ba9fa5', '4bf17a45-d8fc-4e28-9475-c5e3caed1d25', 'c4eb8670-8ecb-4a15-9de5-f291bb02791b', '0ea52838-ad33-431a-9b7d-7205e1744079', '57dd094d-d6d7-43a8-b31c-4776aca3bd19', '018191f2-ef1b-4eb0-a08f-ffa95eee4eb3', '8aa17a59-dc22-49a0-a3ba-82f9212c1fb8', 'cca11330-e9cb-4cff-b5b0-f224a136b7db', '65272553-2ba7-4af1-ae3c-1dd660906c51', '1a155209-c761-4d3e-bff5-71b355a02602', 'c2c0a511-cf75-415b-a4d4-2c0bc5d389dd', 'e6f662cd-7f09-40bf-aae3-5af9d262788a', '0cfdc699-9a8d-4a52-b5b0-2f75445533c1', 'cd7b3d76-526a-434e-bb36-57e9b5cbfb6f');
