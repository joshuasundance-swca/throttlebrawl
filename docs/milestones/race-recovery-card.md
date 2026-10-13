# Race recovery: card contract

`[default]` A prerequisite for the decided M2 reload-resume integration. The existing card assumes every saved attempt is an unfinished ride. APP also needs to explain a completed result awaiting a successful career save, a failed result save, unavailable saved data and a retryable load failure. This contract lands before its APP consumer; it does not itself enable race persistence or complete reload recovery.

## Contract

Keep `showResumeCard(onChoice)` compatible with the existing riding card. Add an optional kind and plain explanation. Choices remain `resume` (the displayed primary action) and `startOver` (the displayed abandon action); APP interprets them according to the offered state. Report the choice synchronously inside its gesture, after hiding the card, and at most once per offer.

| Kind | Primary action | Abandon action | Meaning |
|---|---|---|---|
| `riding` | Resume race | Start over | Resume the unfinished recording into pause |
| `pending-result` | Recover results | Discard result | Recover the finished attempt; discarding loses that result |
| `save-failed` | Retry saving result | Abandon result | Retry the same frozen award, or explicitly abandon it |
| `unavailable` | None | Start over | Saved data cannot resume; APP supplies the reason |
| `retry-load` | Retry | Start over | Load the saved race again, or explicitly abandon it |

UI owns words and the card. It neither reads storage nor restores, settles or discards a race. APP owns those effects, compatibility, keyboard/pointer boot gating and synchronous platform/audio activation. A hidden primary action cannot report a resume choice, including a stale or programmatic click. Replacing an offer retires the old callback.

## Automated acceptance

- The default riding card retains its existing title, explanation and actions.
- Finished and failed-save cards describe a result, offer their own recovery/save actions and explicitly describe abandonment; they do not say the player left mid-race.
- An unavailable offer has no primary action; choosing `resume` reports nothing and does not hide the offer. Its abandon action remains usable.
- A retryable load failure offers Retry and preserves APP's supplied plain explanation.
- A choice hides the card before calling APP, in the same call stack, and only once. Re-offering replaces the old callback; an unavailable replacement cannot activate a previous resume action.
- Normal named units, hooks, types and full CI. The coordinated served recovery check belongs to the APP integration run. No phone, storage, gesture-API or restoration acceptance is inferred from this contract alone.
