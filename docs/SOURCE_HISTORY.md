# Source history

This GitHub repository contains the Cloudflare-backed Coldspan release published from Site source commit `225a9cc57a755d60e02677648b91f4235918426f`. The existing three source commits are preserved in `source-history.bundle`. GitHub initialization used the connected integration because shell Git had no GitHub write credential.

To inspect the original history locally:

```sh
git fetch ./source-history.bundle main:sites-history
git log sites-history
```

The Site remains owner-private. No runtime credentials are included. The original pre-Cloudflare Node/PostgreSQL prototype is a separate earlier artifact, not the active backend.
