-- Label local-lane (`mushi work`) no-PR runs with the verdict their error line
-- already states. Before 2026-10-29 the CLI sent the verdict only as error
-- text (submitPayload), so these rows had failure_category NULL: the console
-- grouped them as "Unrecognised error" with a retry offer and spend-down's
-- NO_RETRY_VERDICTS did not see them. PATCH /v1/admin/fixes/:id now records
-- the category (noPrCategoryFromError); this labels the older rows the same
-- way. Counted on 2026-10-29: needs_human 87, already_fixed 39, wrong_repo 19,
-- not_actionable 13. Only rows with no category are touched; errors unchanged.

update public.fix_attempts
   set failure_category = case
         when error like 'Agent found nothing to change:%' then 'already_fixed'
         when error like 'Agent says the code is in another repo:%' then 'wrong_repo'
         when error like 'Agent found nothing it can tie to code:%' then 'not_actionable'
         when error like 'Agent says this needs a person:%' then 'needs_human'
       end
 where status = 'failed'
   and failure_category is null
   and (error like 'Agent found nothing to change:%'
     or error like 'Agent says the code is in another repo:%'
     or error like 'Agent found nothing it can tie to code:%'
     or error like 'Agent says this needs a person:%');
