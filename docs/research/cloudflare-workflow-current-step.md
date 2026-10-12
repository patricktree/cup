# Cloudflare Workflow current-step introspection

Research date: 2026-09-01

## Conclusion

Cloudflare can expose the steps of a Workflow instance, but not through
`WorkflowInstance.status()` on a Workers binding.

- The Workers binding returns only instance lifecycle state, terminal output,
  error information, and rollback outcome. Its `InstanceStatus` has no current
  step or step history field. See Cloudflare's
  [Workers API reference](https://developers.cloudflare.com/workflows/build/workers-api/#instancestatus).
- The Workflows REST API has a separate instance-details endpoint,
  `GET /accounts/{account_id}/workflows/{workflow_name}/instances/{instance_id}`.
  Its response contains an ordered `steps` array with each step's `name`,
  `type`, start and end timestamps, success state, attempts, and error details.
  The `order=desc` option returns newest steps first. See Cloudflare's
  [Get logs and status from instance API](https://developers.cloudflare.com/api/resources/workflows/subresources/instances/methods/get/).
- Wrangler uses this inspection capability: `wrangler workflows instances
  describe` shows whether each step is running, successful, or failed, along
  with sleeps, retries, output, and errors. See Cloudflare's
  [getting-started guide](https://developers.cloudflare.com/workflows/get-started/guide/#6-deploy-your-workflow)
  and [Wrangler command reference](https://developers.cloudflare.com/workflows/reference/wrangler-commands/#workflows-instances-describe).

Therefore, the earlier statement that a Workflow cannot tell us its current
step was too broad. The accurate statement is: **the in-Worker binding cannot,
but the REST inspection API can return enough per-step execution data to
identify the active step or steps.** The REST response has no dedicated
`currentStep` property, so a caller must interpret its step records. Workflows
can run steps concurrently, so this can be a set rather than one step. See
Cloudflare's [concurrent-step guidance](https://developers.cloudflare.com/workflows/build/rules-of-workflows/#take-care-with-promiserace-and-promiseany).

## Capability boundaries

| Surface                                 | Current-step capability                                                                                                                                                                   |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `WorkflowInstance.status()` binding     | No. It reports lifecycle status such as `running` or `waiting`, but no step name or history.                                                                                              |
| Workflows REST instance-details API     | Yes, indirectly. It returns named step execution records and their state.                                                                                                                 |
| `wrangler workflows instances describe` | Yes, for operator inspection. It displays per-step state from the instance logs.                                                                                                          |
| Cloudflare dashboard                    | Yes, for operator inspection. Cloudflare documents viewing an instance's steps and timing in the dashboard.                                                                               |
| GraphQL Workflows analytics             | Yes, as event data rather than a direct pointer. The dataset includes `instanceId`, `stepName`, `stepCount`, and `eventType`, including `STEP_START`, `STEP_SUCCESS`, and `STEP_FAILURE`. |
| Ordinary Worker application logs        | Only if application code emits suitable logs; they are not the binding's instance-status API.                                                                                             |

Cloudflare documents the Workflows analytics dimensions and event types in
[Metrics and analytics](https://developers.cloudflare.com/workflows/observability/metrics-analytics/).
Those analytics can reconstruct a timeline, but they are a less direct source
for a request-path progress label than the instance-details REST endpoint.
Cloudflare's [Durable AI Agent guide](https://developers.cloudflare.com/workflows/get-started/durable-agents/#8-deploy)
also confirms that the per-step execution view is available in the dashboard.

## Application implication

The application does not use this REST endpoint in its request path. The REST
API cannot inspect Workflow instances that run locally in Wrangler, and it
would add a control-plane request and credential dependency to every pending
conversion poll.

Instead, the Workflow records its latest started application phase in the
grant Durable Object's SQLite `conversions.last_started_phase` column. This
works in both local and deployed environments. The phase enum is independent
of the strings passed to `step.do()`, and the API maps it to user-facing text.
