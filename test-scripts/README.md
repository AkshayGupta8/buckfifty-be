# test-scripts

Small curl-based scripts to hit the BuckFifty BE.

## Base URL selection

By default scripts target your local dev server:
- `http://localhost:3000`

To hit production, pass `--prod`:
- `http://new-be.buckfifty-ai-herdmanager.click`

You can also override explicitly with `--base-url <url>`.

## Examples

```bash
# dev (default)
./test-scripts/users/list_users.sh

# prod (flag)
./test-scripts/users/list_users.sh --prod

# prod (symlink view)
./test-scripts/prod/users/list_users.sh

# dev (symlink view)
./test-scripts/dev/users/list_users.sh

# explicit base url override
./test-scripts/users/list_users.sh --base-url http://localhost:3000

# scripts that take positional args
./test-scripts/users/get_user.sh <user_id>
./test-scripts/users/get_user.sh --prod <user_id>
./test-scripts/prod/users/get_user.sh <user_id>
```
