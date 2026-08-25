# Codebase Critique

Findings collected while working through BUG-001, FEATURE-001 and BONUS-001. Everything here is
**pre-existing**. None of it was introduced by the ticket work, and none of it was required by any
ticket.

Each item lists a severity, a `file:line` reference, and whether it is fixed in this PR. Six
low-risk, high-signal defects are fixed here; the rest are documented deliberately rather than
smuggled in, because fixing them would change behaviour beyond what any ticket asked for.

## Summary

| # | Finding | Severity | Fixed here |
|---|---|---|---|
| 1 | Backend image cannot build, missing `libyaml-dev` | High | Yes |
| 2 | CI has never run, and tests the wrong framework | High | Yes |
| 3 | `RAILS_ENV` leaks into the test suite | High | Yes |
| 4 | Month navigation loses the year | Medium | Yes |
| 5 | `bin/brakeman` fails on a version check, not on findings | Medium | Yes |
| 6 | Lockfile has no Linux platform | Low | Yes |
| 7 | `db:seed` destroys all data on every container boot | High | No |
| 8 | `db/init.sql` corrupts a fresh database | High | No |
| 9 | Rails 7.2.3 is end-of-life | High | No |
| 10 | Two specs assert broken behaviour | Medium | No |
| 11 | Test factory references a non-existent column | Medium | No |
| 12 | `VITE_API_URL` is set but never read | Medium | No |
| 13 | Unbounded collection endpoint | Medium | No |
| 14 | Deleting a category destroys its expenses | Medium | No |
| 15 | Vite never sees file changes through the bind mount | Medium | No |
| 16 | Redundant round-trip on every expense creation | Low | No |
| 17 | Date rendering is timezone-fragile | Low | No |
| 18 | Gems are installed twice and thrown away | Low | No |
| 19 | Dead code | Low | No |
| 20 | Smaller items | Low | No |

---

## Fixed in this PR

### 1. Backend image cannot build, missing `libyaml-dev`

**Severity: High** · `backend/Dockerfile:12`

`Gemfile.lock` pins `psych (5.3.1)`, whose native extension needs `yaml.h`. The `ruby:3.3.7-slim`
base image does not ship it, so `bundle install` fails with `Gem::Ext::BuildError` during
`docker compose build`. This breaks the very first step of the README for every new developer, on
every machine.

Verified directly:

```
$ docker run --rm ruby:3.3.7-slim ls -l /usr/include/yaml.h
ls: cannot access '/usr/include/yaml.h': No such file or directory
```

Added `libyaml-dev` and `pkg-config` to the `apt-get install` line. `pkg-config` is what psych's
`extconf.rb` uses to locate libyaml, so both are needed.

### 2. CI has never run, and tests the wrong framework

**Severity: High** · `backend/.github/workflows/ci.yml`

Two independent faults, either of which alone is fatal:

1. GitHub only reads workflows from `.github/workflows/` **at the repository root**. This file sat
   at `backend/.github/workflows/`, so it has never executed once. The repository has no CI history.
2. Its test step ran `bin/rails db:test:prepare test test:system`, which is **Minitest**. This
   project uses RSpec and has no `test/` directory. Even from the right location it would have
   verified nothing.

The workflow is moved to `.github/workflows/ci.yml` with `working-directory: backend` defaults, and
the test step now runs `bundle exec rspec`. Three further corrections were needed to make it
actually pass rather than merely run:

- The old `DATABASE_URL: mysql2://127.0.0.1:3306` does not match this app's configuration contract.
  `config/database.yml:5-8` reads `DATABASE_HOST` / `DATABASE_USERNAME` / `DATABASE_PASSWORD`, so
  the job now sets those.
- The package list installed `google-chrome-stable` and `libvips` for system tests that do not
  exist, but omitted `default-libmysqlclient-dev`, which the `mysql2` gem needs to compile.
- Dropping the Minitest invocation also dropped `db:test:prepare`, so the first run failed with
  `Unknown database 'expense_system_test'`. The step now prepares the database before invoking RSpec.

I also added a `typecheck` job running `npx tsc --noEmit` against the frontend. The frontend had no
CI coverage at all, and this is the same gate the README asks contributors to run locally.

### 3. `RAILS_ENV` leaks into the test suite

**Severity: High** · `backend/spec/rails_helper.rb:3`, with `docker-compose.yml:41`

```ruby
ENV['RAILS_ENV'] ||= 'test'
```

Compose sets `RAILS_ENV: development` on the backend container, so `||=` never fires and **RSpec
runs against the seeded development database**. Observed directly on a clean checkout: every spec
failed with `Duplicate entry 'Food' for key 'categories.index_categories_on_name'`.

Nothing was lost only because `use_transactional_fixtures` is `true` and rolled each example back.
The suite is one configuration change away from truncating a developer's working database. In the
meantime, the command the README documents for running tests simply does not work.

Changed to an unconditional assignment. A spec run is never meant to target another environment, so
there is no case in which deferring to an inherited value is correct:

```ruby
ENV['RAILS_ENV'] = 'test'
```

`README.md:166-169` tells contributors to run a bare `bundle exec rspec`; that now does the right
thing instead of requiring an undocumented `RAILS_ENV=test` prefix.

### 4. Month navigation loses the year

**Severity: Medium** · `frontend/src/pages/HistoryPage.tsx:73`

`MonthNavigation` handles year rollover correctly. `MonthNavigation.tsx:36` calls
`onMonthChange(12, currentYear - 1)` when you page back from January. But the page's handler
declared only one parameter and dropped the second:

```tsx
const handleMonthChange = (month: number) => {
  setSelectedMonth(month);
  updateURL(selectedYear, month);
};
```

So clicking "←" from January 2026 landed on **December 2026** instead of December 2025, silently
showing the wrong year's data. The prop type is `(month: number, year: number) => void`, and
TypeScript accepts a handler with fewer parameters as assignable, so the compiler never flagged it.
This class of bug is invisible to `tsc` by design.

The handler now accepts and applies the year.

### 5. `bin/brakeman` fails on a version check, not on findings

**Severity: Medium** · `backend/bin/brakeman:5`

```ruby
ARGV.unshift("--ensure-latest")
```

The binstub unconditionally forces `--ensure-latest`, which makes Brakeman exit non-zero whenever
the pinned version is behind the newest published gem, regardless of whether it found anything.
`Gemfile.lock` pins `brakeman (7.1.1)` and 8.0.6 is current, so the scan exits 5 with the message
"Brakeman 7.1.1 is not the latest version 8.0.6" and **zero warnings reported**.

This was latent only because the workflow never ran (item 2). The moment CI worked, the security
job failed for a reason that has nothing to do with security, and would keep failing on every future
Brakeman release. Coupling a scan's exit status to gem currency also trains people to ignore it.

Removed the line. Keeping dependencies current is Dependabot's job, not the exit code of a static
analysis run.

With that gone the scan works and reports one genuine finding (see item 9).

### 6. Lockfile has no Linux platform

**Severity: Low** · `backend/Gemfile.lock`

`PLATFORMS` listed only `arm64-darwin`, generated on an Apple Silicon Mac and never updated,
despite the app running in `x86_64-linux` containers. Booting the backend rewrites the file to add
the missing platform, so it reappeared as a spurious diff on every branch.

Normally I would leave a lockfile change out of an unrelated PR, but the CI job added in item 2 runs
on `ubuntu-latest` and resolves gems for `x86_64-linux`. Committing the platform line here is what
makes that job deterministic, so it is included deliberately rather than reverted for a fifth time.
The diff is exactly the two entries Bundler adds: the `x86_64-linux` platform and the matching
`nokogiri` native gem.

---

## Documented, not fixed

### 7. `db:seed` destroys all data on every container boot

**Severity: High** · `docker-compose.yml:59` with `backend/db/seeds.rb:1-4`

The backend's startup command runs `rails db:seed` unconditionally on every boot, and `seeds.rb`
opens with:

```ruby
Expense.destroy_all
Category.destroy_all
```

Every `docker compose up`, every `docker compose restart backend`, every container crash-and-restart
wipes all user data and replaces it with fixtures. I hit this during manual verification of
BONUS-001: categories and expenses created minutes earlier were gone after a routine restart.

This is worse now that FEATURE-001 lets users create their own categories: the feature appears to
work and then quietly loses its data. `destroy_all` also instantiates and destroys all 4,263 seeded
expense rows one at a time, making every boot slow.

**Suggested fix:** make seeding idempotent (`find_or_create_by!`) and drop the `destroy_all` calls,
or gate seeding behind an explicit opt-in rather than running it in the default startup command.
Left out of scope because it changes the documented developer workflow and deserves its own
discussion.

### 8. `db/init.sql` corrupts a fresh database

**Severity: High** · `db/init.sql:16-27`, mounted at `docker-compose.yml:16`

The file is mounted into `/docker-entrypoint-initdb.d`, so MySQL executes it on first boot of a new
volume. It creates an `expenses` table with **no `date` column** and a mandatory `payer_name`.
Because both Rails migrations use `create_table ... if_not_exists: true`, they then silently skip
while still stamping `schema_migrations`, leaving the app pointed at a schema it cannot use.
`db:seed` dies on an unknown `date` attribute.

Reproduced on a clean volume during setup. The file is also internally inconsistent with the rest of
the project. It seeds `Transport` / `Supplies` / `Utilities`, whereas `db/seeds.rb` uses
`Transportation` / `Bills` / `Personal`.

**Suggested fix:** delete `db/init.sql` and remove the volume mount. Rails migrations own the
schema; a parallel hand-maintained DDL file is guaranteed to drift from them.

### 9. Rails 7.2.3 is end-of-life

**Severity: High** · `backend/Gemfile.lock:176`

Once item 5 was fixed and Brakeman could actually run, it reported:

```
Confidence: High
Category: Unmaintained Dependency
Check: EOLRails
Message: Support for Rails 7.2.3 ended on 2026-08-09
```

The application is running a Rails version that no longer receives security patches, including for
vulnerabilities disclosed after the EOL date.

**Suggested fix:** upgrade to a maintained release (7.2 → 8.0). That is a dependency upgrade with
its own testing and review burden, well outside a critique PR.

In the meantime the warning is recorded in `backend/config/brakeman.ignore` with a note explaining
why, so the security job gates on *newly introduced* issues rather than failing every run on a known
one. The ignore entry is the tracking mechanism, not a dismissal. Remove it as part of the upgrade.

### 10. Two specs assert broken behaviour

**Severity: Medium** · `backend/spec/requests/api/expenses_spec.rb:53-87`

Under a `context "with invalid parameters"` block, two examples assert that an amount of `-100.00`
and an **empty description** are both accepted with `201 Created`. They pass because `Expense` has
no validations, so the tests document the bug instead of catching it.

**Suggested fix:** add `validates :amount, numericality: { greater_than: 0 }` and
`validates :description, presence: true`, then invert both specs to expect `422`. Deliberately not
done here: it is an API behaviour change that no ticket requested. BONUS-001 added the one
validation that *was* asked for.

### 11. Test factory references a non-existent column

**Severity: Medium** · `backend/spec/factories/expenses.rb`

The factory sets `payer_name`, which is not in `schema.rb`, omits `date`, which is `null: false`,
and defaults `category` to `nil` against a required `belongs_to`. Any use of it raises immediately.
The suite runs only because nothing currently calls it, a trap for the next person who tries.

**Suggested fix:** drop `payer_name`, add `date { Date.current }`, and use `association :category`.

### 12. `VITE_API_URL` is set but never read

**Severity: Medium** · `frontend/src/services/api.ts:7` vs `docker-compose.yml:71`

`API_BASE_URL` is the hardcoded string `"http://localhost:3000/api"` while Compose defines a
`VITE_API_URL` environment variable that nothing consumes. The frontend cannot be pointed at a
staging or production backend without editing source. The one-line fix is
`` `${import.meta.env.VITE_API_URL ?? "http://localhost:3000"}/api` ``, left out because it belongs
with a real deployment story rather than a drive-by change.

### 13. Unbounded collection endpoint

**Severity: Medium** · `backend/app/controllers/api/expenses_controller.rb`

`GET /api/expenses` without `year`/`month` returns **every** row, 4,263 in the seeded database,
serialised one hash at a time. `CalendarExpenseTable` then paginates client-side at 10 per page, so
essentially the entire payload is discarded. Server-side pagination, or making the month filter
mandatory, is the right answer; both are larger design decisions than this PR should make.

### 14. Deleting a category destroys its expenses

**Severity: Medium** · `backend/app/models/category.rb:2`

`has_many :expenses, dependent: :destroy` means removing a category silently deletes all its
financial history. `dependent: :restrict_with_error` is the safer default for reference data. Not
urgent today because no delete endpoint is exposed, but FEATURE-001 makes categories user-managed,
so this is now one small feature away from destroying real records.

### 15. Vite never sees file changes through the bind mount

**Severity: Medium** · `docker-compose.yml:77` and `frontend/vite.config.ts`

Vite's file watcher relies on inotify, which does not receive events across Docker bind mounts on
Windows and macOS hosts. Editing a frontend file changes it inside the container (verified), but
the dev server keeps serving the previously built module, so the browser shows stale UI. During this
exam every frontend change required `docker compose restart frontend` to appear.

Anyone on a non-Linux host will conclude their changes "don't do anything", which is a costly first
impression.

**Suggested fix:** set `server.watch.usePolling: true` (with a modest `interval`) in
`vite.config.ts`. Polling costs some CPU, so it is usually gated on an env var. Left out because it
touches shared dev configuration and deserves a conscious decision about that trade-off.

### 16. Redundant round-trip on every expense creation

**Severity: Low** · `frontend/src/services/api.ts:52-62`

`createExpense` fetches the entire category list on every call purely to translate a category *name*
into an id. Beyond the wasted request, when no match is found `category?.id` is `undefined` and the
request is sent anyway; the server rejects it on the `belongs_to` and the user sees the generic
"Failed to create expense".

**Suggested fix:** have the form submit `category_id` directly. That also resolves the ambiguity
where two categories differing only in case would be indistinguishable. It is a genuine refactor of
the form's data model, so it stayed out of FEATURE-001.

### 17. Date rendering is timezone-fragile

**Severity: Low** · `frontend/src/utils/expenseUtils.ts:45`, `CalendarExpenseTable.tsx:135`

`new Date("2026-02-18")` parses as **UTC midnight**, and `.getDate()` reads it back in local time.
In any negative-UTC-offset timezone that yields 17 February, so every expense shows up a day early.
Invisible from UTC+8 where this was developed, wrong for a reviewer in the Americas. Splitting the
string (`expense.date.split("-")`) avoids `Date` entirely.

### 18. Gems are installed twice and thrown away

**Severity: Low** · `backend/Dockerfile:19-21` vs `docker-compose.yml:52-57`

The image sets `bundle config path 'vendor/bundle'`, so gems land in `/rails/vendor/bundle`. Compose
then bind-mounts `./backend` over `/rails`, masking them completely, which is why the startup
command has to run `bundle install` a second time before the server can boot.

**Suggested fix:** drop the `path` setting so gems install to the default `/usr/local/bundle`, which
is exactly what the existing `backend_gems` volume already targets. The second install then becomes
a no-op and container startup gets noticeably faster.

### 19. Dead code

**Severity: Low**

| Item | Location | Note |
|---|---|---|
| `fetchExpenses` | `services/api.ts:12-18` | Never imported; `HistoryPage` defines its own local function of the same name |
| `QuickAddButton` | `components/QuickAddButton.tsx` | Never rendered |
| `ItemTable`, `ColumnBase`, `FormControl` | `vibes/` | Exported from `vibes/index.ts`, never consumed. `CalendarExpenseTable` hand-rolls its own table rather than using `ItemTable` |

`constants/categories.ts` was also dead code by the end of FEATURE-001 and was removed in that PR.

### 20. Smaller items

| Location | Issue |
|---|---|
| `docker-compose.yml:1` | `version: "3.8"` is obsolete; Compose v2 prints a warning on every command |
| `vibes/Modal.tsx` | No focus trap, no `role="dialog"`, no `aria-modal`, and focus is never returned to the trigger on close |
| `config/initializers/cors.rb:10` | `origins "*"` with all verbs. Fine in development, must be environment-scoped before production |
| `constants/categoryEmojis.ts` | Missing `Personal`, which `db/seeds.rb` creates; it silently falls back to the default icon |
| `expenses_controller.rb:54` | `amount.to_f` converts `BigDecimal` money to a float, discarding exactness for no benefit |
| `vibes/ItemTable.tsx:13,18` | `any` types undercut the "type-safe UI" claim in the README |
| `CalendarExpenseTable.tsx:55` | `alert()` for delete failures, while every other error path uses inline messages |
