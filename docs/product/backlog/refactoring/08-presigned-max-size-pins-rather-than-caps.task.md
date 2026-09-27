# Task 08 — Backend: `PresignedUrlOptions.maxSizeBytes` pins the upload size instead of capping it

**Status:** 📝 Open
**Team:** Backend API
**Found in:** Milestone 20, Task 04 (events flyer lifecycle), 2026-09-22

## Summary

`IStorageAdapter.getPresignedUploadUrl` accepts `maxSizeBytes`, a name that promises an
upper bound. `R2StorageAdapter` maps it to `PutObjectCommand.ContentLength`
(`r2-storage-adapter.ts:121`), and the AWS SDK emits `ContentLength` into the **signed
headers** — verified directly:

```
WITH    ContentLength → X-Amz-SignedHeaders = content-length;host
WITHOUT ContentLength → X-Amz-SignedHeaders = host
```

So the value is not a ceiling the upload must stay under; it is an exact byte count the
upload must **match**, or the signature fails. Passing a true maximum (say the 5 MB image
limit) makes every upload that is not exactly 5,242,880 bytes fail.

Both current callers happen to pass the client-declared size, so the behaviour is correct
today — a caller cannot substitute a different payload through the URL. The defect is that
the **name lies**, and the next person to read it as "cap" will pass a ceiling and break
uploads. Milestone 20 Task 04 did exactly that, on an instruction derived from the name,
and it was caught only by measuring.

## Why it matters

- The name invites a change that silently breaks every non-exact-size upload. There is no
  type error and no test failure at the call site — the break only appears when a real
  browser PUTs real bytes.
- It obscures the genuine security property. The thing that actually enforces a limit is
  re-reading the **stored** object's size at finalize (`headObject`). `admin-media.controller.ts`
  still lacks that check; `admin-events.controller.ts` now has it.

## Scope

In:
- Rename the option to what it does (e.g. `exactSizeBytes` / `contentLength`), or drop the
  `ContentLength` mapping and let the presign place no size constraint — decide which,
  since R2 has no S3 POST-policy equivalent for a presigned `PUT`, so a real cap is not
  expressible at signing time.
- Update `PresignedUrlOptions` in `packages/shared/ports/i-storage-adapter.ts`, the R2
  adapter, and both call sites.
- A doc comment stating plainly that a presigned PUT cannot express an upper bound, and
  that the ceiling is enforced at finalize.

Out:
- Adding the missing finalize size check to **topic** media — related but separate; it
  touches the upload path the bulk importer depends on. That is its own item.

## Acceptance Criteria

- [ ] The option's name matches its behaviour, or the mapping is removed.
- [ ] A doc comment states that a presigned PUT cannot cap size and names finalize as the
      enforcement point.
- [ ] Both call sites still upload real bytes end to end; `make test-api` green.
- [ ] No behaviour change for a caller passing the declared size.
