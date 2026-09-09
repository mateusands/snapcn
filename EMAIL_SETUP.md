# Email setup

Everything the app does about deliverability is in the code and tested. Everything
Gmail actually checks is in DNS, and DNS is not in this repo. This file is the
second half.

## The thing to be clear about first

**Gmail is never told that somebody subscribed.** There is no header for it, no
API, no flag. What decides inbox vs Promotions vs Spam is four things, and only
the first is under our direct control:

| what Gmail measures | where it comes from |
| --- | --- |
| Authentication — SPF, DKIM, DMARC, all aligned | DNS, below |
| Spam complaint rate, hard ceiling **0.3%** | who is on the list |
| Bounce rate | who is on the list |
| Engagement — opens, replies, moves to inbox | whether the mail is worth reading |

Double opt-in is not something Gmail can see. It is simply the cheapest way to
make rows two and three come out right, because a confirmed list is a list of
real, reachable people who remember asking.

And the tab is a separate question again: **Primary vs Promotions is content
classification**, not reputation. A remote logo, a row of footer links and a
large coloured CTA read as marketing — correctly, for a newsletter. That is why
`shell()` has two chromes and the sign-in link uses the plain one.

---

## 1. DNS — do this before anything else

Current state, checked with `dig`:

```
✅ resend._domainkey.snapcn.dev   DKIM, present
✅ send.snapcn.dev TXT            v=spf1 include:amazonses.com ~all
✅ send.snapcn.dev MX             feedback-smtp.us-east-1.amazonses.com
⚠️ _dmarc.snapcn.dev              v=DMARC1; p=none;     ← no rua, no enforcement
❌ snapcn.dev MX                  none                  ← hello@snapcn.dev bounces
❌ mail.snapcn.dev                nothing               ← no separate bulk stream
```

SPF is already correct and does not need a record on the apex: Resend's bounce
domain is `send.snapcn.dev`, that is where SPF is evaluated, and it aligns with
the header `From` under relaxed alignment because both share the organisational
domain. Do not add `v=spf1` to `snapcn.dev` — it is not what is missing.

### 1a. MX on the apex — the `From` address must be able to receive

`EMAIL_FROM` is `hello@snapcn.dev` and that address bounces everything sent to
it. A `From` nobody can reply to is scored as bulk, and a real person's reply
disappearing is worse than the score.

Either point it at a mailbox:

```
snapcn.dev.   MX  10  <your mail host>
```

or change `EMAIL_FROM` to an address on a domain that already receives. Add
`Reply-To` at the same time if the two differ.

### 1b. DMARC — get reports, then enforce

```
_dmarc.snapcn.dev.  TXT  "v=DMARC1; p=none; rua=mailto:dmarc@snapcn.dev; fo=1"
```

`p=none` publishes nothing about what to do with a failure; `rua` is what makes
it useful, because it is the only way to find out that something is sending as
you. Read a fortnight of reports, confirm every legitimate source passes, then
tighten in one step:

```
_dmarc.snapcn.dev.  TXT  "v=DMARC1; p=quarantine; rua=mailto:dmarc@snapcn.dev; fo=1; pct=100"
```

`rua` needs a mailbox that exists — so 1a first.

### 1c. A subdomain for the list

The newsletter and the sign-in link must not share a reputation. Add
`mail.snapcn.dev` as a second domain in the Resend dashboard, publish the DKIM
and bounce records it gives you, then set:

```
EMAIL_FROM_NEWSLETTER="snapcn <news@mail.snapcn.dev>"
```

Until that variable is set the code sends everything from `EMAIL_FROM`, which is
exactly the old behaviour — so this is safe to do late, and expensive to skip.

---

## 2. Resend webhook

Point a webhook at `https://snapcn.dev/api/webhooks/resend` for at least
`email.bounced` and `email.complained`, and put its `whsec_…` signing secret in
`RESEND_WEBHOOK_SECRET`.

Without it nothing writes the suppression list: a hard-bounced address stays on
the list and is mailed on every campaign forever, and a spam complaint is
invisible. Both are charged against the domain the sign-in links go out on.

The endpoint answers **503** with no secret, so a missing variable is loud rather
than a silently unsigned endpoint that anybody can use to block a user's mail.

---

## 3. What the code does

| file | job |
| --- | --- |
| `lib/server/email.ts` | the `fetch`, two senders, five templates, one-click headers |
| `lib/server/subscription.ts` | confirm / unsubscribe / look up, by token |
| `lib/server/suppression.ts` | may this address be mailed at all |
| `lib/server/resend-events.ts` | does this webhook event mean "never again" |
| `app/api/subscribe/route.ts` | rate-limited, throttled, double opt-in |
| `app/subscribe/confirm/[token]/` | the only place a row becomes real |
| `app/u/[token]/` + `app/api/unsubscribe/[token]/` | the page, and the endpoint |
| `app/api/webhooks/resend/` | bounces and complaints |

Two design points worth not undoing:

- **The unsubscribe page does not unsubscribe.** Mail clients and corporate link
  scanners GET every URL in a message before a human sees it. The page draws a
  button; the button POSTs; RFC 8058 one-click POSTs to the same endpoint. A GET
  that acted would empty the list from the inside and the symptom would point
  nowhere near the cause.
- **A transient bounce does not suppress.** Only `Permanent` does. Suppressing on
  a full mailbox is a real user permanently unable to receive a sign-in link,
  silently, with no way to tell us.

---

## 4. Operating it

**Confirm rate** — the number that says whether double opt-in cost you the list.
There is no analytics event for it because there is a column:

```sql
select
  count(*)                                             as signups,
  count(*) filter (where confirmed_at is not null)      as confirmed,
  round(100.0 * count(*) filter (where confirmed_at is not null) / count(*), 1) as pct
from subscriber;
```

Healthy is 60–80%. Under 40% means the confirm mail is not arriving — check the
Resend dashboard for that address before assuming people are ignoring it.

**Who may actually be mailed:**

```sql
select count(*) from subscriber s
where s.confirmed_at is not null
  and s.unsubscribed_at is null
  and not exists (select 1 from email_suppression e where e.email = s.email);
```

**Before the first real campaign:**

- [ ] 1a, 1b, 1c above
- [ ] `EMAIL_POSTAL_ADDRESS` set — legally required on commercial mail
- [ ] `RESEND_WEBHOOK_SECRET` set and a test event delivered
- [ ] Send to yourself at Gmail, Outlook and one corporate domain; check the
      one-click unsubscribe appears next to the sender name in Gmail
- [ ] Warm up: a first send to a few hundred, not to everybody. A cold domain
      that sends thousands on day one is treated as one that was bought to do it.

---

## 5. The existing list

Migration `0006_email_double_opt_in.sql` back-fills `confirmed_at = created_at`
for every row that already existed. Those addresses typed themselves into the
form and were sent a welcome mail, so they are opted in by the standard that was
in force when they joined, and leaving them null would have muted the whole list
silently.

If the list is old enough that consent is genuinely in doubt, delete that
`UPDATE` from the migration before running it and send a re-permission campaign
instead. From this migration on, nothing new is mailed to an address that has not
opened its own confirm link.
