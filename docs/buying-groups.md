# Buying groups (Phase 49)

Businesses that buy on FIRINGI — wholesale customers (restaurants, shops…) and wholesalers buying from distributors —
pool their purchases.

## Pure rules (src/lib/buying-groups.ts — unit-tested)

- `GroupSettings` (FIRINGI's switches, `Setting` key `groups.settings`): `enabled`, `members{CUSTOMER, WHOLESALER}`,
  `creators{CUSTOMER, WHOLESALER}`, `approval` ALWAYS / AUTO, `features{pooledRebates, groupPrices, reports,
  groupOrders}`, `joinRequests`, `multipleGroups`, `maxMembers` (2–1000, default 50), `roundMaxDays` (1–60,
  default 14). `mergeGroupSettings()` fills defaults; `cleanGroupSettings()` validates.
- `shareMoney(total, weights)` — a pooled bonus split by each member's purchases, to the cent, largest remainder, the
  parts add up exactly; members with nothing (or negative) bought get nothing.
- `shareUnits(units, weights)` — the same for whole free units.

## Data (prisma/schema/buying-groups.prisma)

| Model | What |
|---|---|
| `BuyingGroup` | name, description, country (the creator's), `open` (join requests), status PENDING / APPROVED / REJECTED / CLOSED, FIRINGI's review |
| `BuyingGroupMember` | one row per group × business: role ADMIN / MEMBER, status INVITED / REQUESTED / ACTIVE / DECLINED / LEFT / REMOVED, `joinedAt`, `leftAt` |
| `GroupOrderRound` | a group order: supplier, name, note, `closesAt`, `deliveryDate`, status OPEN / PLACED / CANCELLED |
| `GroupOrderLine` | a member's line (offer, qty, delivery address); after placing: `orderId` or `error` |

Links: `CustomerGroup.buyingGroupId` (a supplier's price group for a buying group), `TradeBonus.buyingGroupId`
(audience `BUYING_GROUP`), `Order.groupRoundId`. Per-business switch: `CompanyFeature` key `BUYING_GROUPS`
(no row = by type, ON, OFF).

## Service (src/server/buying-groups/service.ts)

- **Access** — `groupAccess(company)` → `{member, create, why}` from the settings, the business type and its switch.
  Only the owner or a user with `company.profile.manage` acts for the business (start, invite, answer, leave…);
  adding to group orders needs `buyer.orders.place`.
- **Groups** — `createGroup` (creator = ADMIN; PENDING unless approval AUTO; FIRINGI notified `group.review`),
  `reviewGroup` (FIRINGI, reason required to turn down; `group.decided`), `updateGroup`, `closeGroup` (admins or
  FIRINGI: open rounds cancelled, group price lists switched off).
- **Members** — `inviteMember` by NIF / VAT number (case-insensitive, APPROVED businesses that may join;
  `group.invited`), `respondInvite`, `openGroups` + `requestJoin` (`group.join_request`) + `decideRequest`
  (`group.join_decided`), `leaveGroup` (the last admin leaving hands the role to the oldest member; the last member
  leaving closes the group), `removeMember`, `setRole`. `maxMembers` and `multipleGroups` are enforced on joining.
  `membersDuring(groupId, start, end)` gives who was a member during a period.
- **Group prices** — `setGroupPrices(ctx, groupId, {pct | items, validTo})`: the supplier gets its own
  `CustomerGroup` "Buying group: …" linked to the buying group, with a `CUSTOMER_GROUP` price list (priority 5);
  `syncPriceGroups()` keeps that customer group's members equal to the active members, so the normal pricing applies
  the group price in the shop, cart and checkout. `stopGroupPrices` switches it off. Members are told (`group.prices`).
- **Pooled rebates** (src/server/rebates/service.ts) — a deal with audience `BUYING_GROUP` (needs `pooledRebates` and
  an approved group; "each shop on its own" is off). `pooledResults()` adds up the members' purchases (members during
  the period), evaluates the rules on the total and splits the value with `shareMoney` (free units with `shareUnits`);
  each member is settled with its own credit note as for any deal. *My Bonuses* shows the group's progress and the
  member's share.
- **Group orders** — `openRound` (group admin; supplier approved; closes within `roundMaxDays`; delivery not before
  the close; members told `group.round_opened`), `setRoundLine` (qty 0 removes; refused when the round is closed or
  when the supplier doesn't sell to the member's type), `cancelRound`, `placeRound(roundId, by?)` — claims the round
  OPEN → PLACED once, then for each member places its own order (`placeOrder` as the user who added the lines, the
  member's address, the round's delivery date, note "Group order: …", `groupRoundId`), records the order or the
  error, and notifies (`group.round_placed` / `group.round_failed`; supplier `group.round_supplier`).
  `runGroupsJob()` places rounds whose closing time has passed (`/api/cron/groups`, every 15 minutes).
- **Reading** — `myGroups`, `groupDetail` (non-admins see active members only), `roundDetail`, `roundOffers`,
  `groupReport(ctx, groupId, MONTH | QUARTER | YEAR)` (FIRINGI's invoices to the members minus credit notes, excl.
  VAT; by supplier; by member for group admins and FIRINGI; the member's own share; settled group bonuses).
- **FIRINGI** — `adminGroups`, `groupsOverview`, `companySwitches`, `findBusiness`, `saveGroupSettings`,
  `setCompanySwitch` (audited).

## Pages

| Who | Where |
|---|---|
| Customers / wholesalers (25 languages) | `/buy/groups` (invitations, my groups, start a group, find open groups), `/buy/groups/[id]` (members, invite, requests, group prices, group deals, group orders, report), `/buy/groups/[id]/rounds/[roundId]` |
| Suppliers (25 languages) | `/vendor/products/buying-groups` (approved groups, members that can buy from the supplier, set / stop group prices); group rebate deals in *Rebates & Bonuses* |
| FIRINGI (English) | `/admin/customers/buying-groups` (overview, waiting for approval, all groups), `/[id]`, `/settings` (every switch + per-business on / off) |

## Tests

- `tests/unit/buying-groups.test.ts` — sharing money and units, settings.
- `tests/integration/buying-groups.test.ts` — switches, approval, invitation / join request, one group per business,
  group prices in checkout, a pooled rebate shared by purchases, group orders placed per member, the job, the report,
  closing.
- `node tests/e2e/buying-groups.mjs [baseUrl] [shots]` — the whole flow in the browser, phone and dark.
