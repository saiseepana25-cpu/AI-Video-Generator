# Local AI planning

Run from the repository folder. Application credentials stay in `apps/web/.env.local`; never paste them into commands or commit them.

1. Apply schemas once: `npm.cmd run web:db:migrate` (stop the app/worker first when upgrading).
2. Check the same API project/model in AI Studio. Billing must remain disabled. Current reviewed defaults use `gemini-3.5-flash-lite`, `GEMINI_API_KEY` and `GEMINI_FREE_TIER_CONFIRMED=true`. Model discovery alone cannot verify quota.
3. Read the current budget revision: `npm.cmd run web:planning -- status`.
4. Record a conservative remaining free allowance: `npm.cmd run web:planning -- budget 10 0` for a first observation (revision zero). Later observations use the actual displayed revision, not zero. Do not claim more capacity than the project's observed remaining free requests. Observation expires within one hour and before midnight Pacific. This command cannot clear uncertain submissions.
5. In a separate terminal: `npm.cmd run web:planning -- worker`. Keep it running. It processes one request per minute at most and never switches to a paid model. Ctrl+C finishes the bounded active request before releasing its lease.
6. Start the dashboard with `npm.cmd run web:dev` (or build/start), then open `http://127.0.0.1:3000/projects`. Open a saved project and choose **Suggest three ideas** or **Prepare my plan**. Voice can be selected later. English produces English captions; Telugu produces Telugu captions.

If free access changes after acceptance, the job pauses. Refresh quota after checking AI Studio, then explicitly retry a known retryable job. Requests with unknown consumption pause all planning and have no automatic retry or clearance command; retain their attempts for manual provider reconciliation. No top-up, billing activation, or fallback is performed. Other clients can consume the same Google project quota, so 429 remains possible even with a local budget.

Planning uses up to 24 KB saved input, 3–8 diagram scenes, and up to 8,192 response tokens. Shorten references if refused. No URLs are fetched. Review scientific accuracy, diagram relationships and native pronunciation; the proposal is not approved for generation. Detailed plan editing and approval are F08/F09, and video integration is F10. Restart worker/app after changing provider configuration. Do not run another worker against the same database to bypass spacing or unknown-outcome safeguards.
