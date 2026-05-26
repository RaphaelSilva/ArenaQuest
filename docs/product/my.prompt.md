/product-owner create a milestone for RFC @docs/product/RFCs/0003-apps-api-route-organization-and-openapi.md 
and create a prompt following 

```
  Run every task under `docs/product/milestones/9-apps-api-route-organization-and-openapi/`
  in this order:
    01, 02, 03, ..., 08, 09, 10, 11

  Executor model policy:
    - haiku for 01, 02, ..., 10, 11 (mechanical)
    - sonnet for 05, ..., 08, 09 (refactor de pares — judgment-heavy)

  Scope guardrail (enforce in every child prompt):
    only [scope-folder-list]. Any out-of-scope edit must emit
    `BLOCKED:`.

  Verify each task with `make lint` + `make test-api` (for backend) + `make test-web` (for frontend). 

  Start with task 01.
```