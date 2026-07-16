# Azure Janitor, Setup Guide

An internal dashboard that visualises a team's Azure Resource Groups, flags idle or abandoned development resources, estimates the money they waste, and offers one-click Hibernate (scale down or deallocate) and Teardown (delete) actions.

```
azure-janitor/
  server/   Express + TypeScript API (port 4000)
  web/      Vite + React + shadcn/ui dashboard (port 5173, proxies /api to 4000)
```

## 1. Quick start (mock mode, no Azure required)

```bash
# Terminal 1
cd server
npm install
cp .env.example .env          # MOCK_MODE=true is already the default
npm run dev                   # http://localhost:4000

# Terminal 2
cd web
npm install
npm run dev                   # http://localhost:5173
```

Mock mode serves 18 synthetic resources across 4 resource groups and is fully demoable, including hibernate, teardown, safety rails, and activity evidence. A "Demo data" badge appears in the header.

## 2. Authentication for live mode (pick one)

Set `MOCK_MODE=false` in `server/.env`, then choose:

**Option A, `az login` (fastest for a hackathon).** `DefaultAzureCredential` picks up your Azure CLI session automatically.

```bash
az login
az account set --subscription "<SUBSCRIPTION_ID>"
```

Then set only `AZURE_SUBSCRIPTION_ID` in `server/.env`. Trade-off: it authenticates as you personally, so it is unsuitable for anything shared or deployed.

**Option B, service principal (better for a shared or deployed API).**

```bash
az ad sp create-for-rbac \
  --name "azure-janitor" \
  --role "Reader" \
  --scopes "/subscriptions/<SUBSCRIPTION_ID>"
```

Copy the returned values into `server/.env`:

```
AZURE_SUBSCRIPTION_ID=<subscription id>
AZURE_TENANT_ID=<tenant>
AZURE_CLIENT_ID=<appId>
AZURE_CLIENT_SECRET=<password>
```

Trade-off: a secret now exists and must be kept out of source control. `.env` is git-ignored; never commit it and never share the secret.

## 3. RBAC roles required

| Role | Needed for |
|---|---|
| Reader (subscription scope) | Listing resources and reading activity logs |
| Cost Management Reader | Only if `USE_CONSUMPTION_API=true` |
| Contributor (scoped to one sacrificial dev resource group) | Hibernate and teardown actions |

Do not grant Contributor at subscription level for a hackathon tool. Granting it on a single disposable resource group is the safest path.

## 4. Environment variables (server/.env)

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `4000` | API port |
| `MOCK_MODE` | `true` | Serve synthetic data, no Azure calls at all |
| `USE_CONSUMPTION_API` | `false` | Replace the static price map with real Consumption API figures |
| `AZURE_SUBSCRIPTION_ID` | empty | Required for live mode |
| `AZURE_TENANT_ID` / `AZURE_CLIENT_ID` / `AZURE_CLIENT_SECRET` | empty | Only for service principal auth |

## 5. Sanity checks

```bash
curl http://localhost:4000/api/summary        # totals
curl http://localhost:4000/api/resources      # resource list
```

- `AuthorizationFailed`: your identity lacks the Reader role on the subscription.
- `CredentialUnavailableError`: no credential source was found. Run `az login` or set the three `AZURE_*` variables.

## 6. Safety rails

- Hibernate and teardown are refused on any resource tagged `protected: true` or in a resource group whose name contains `prod`.
- Teardown requires the caller to type the exact resource name.
- Every destructive action is appended to `server/actions.log` with a timestamp and resource id.

## 7. Cost figures are estimates

By default, daily costs come from a hard-coded price map of common SKUs (`server/src/services/priceMap.json`), multiplied by running hours. The UI labels them as estimates. Set `USE_CONSUMPTION_API=true` (with the Cost Management Reader role) to swap in real usage figures.

## 8. Recommended demo strategy

Run the demo in `MOCK_MODE=true` and switch to live mode only for the final "it is real" moment against a disposable resource group. Activity log queries can be slow, dev subscriptions are unpredictable, and a deletion that hangs mid-demo is worse than mock data. The provider interface (`server/src/azure/provider.ts`) exists precisely so this switch costs nothing.
