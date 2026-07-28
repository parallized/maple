# Maple hosted deployment

1. Point the selected domain's A/AAAA record at the host.
2. Copy `deploy/.env.example` to `.env` and set `MAPLE_DOMAIN`.
3. Run `docker compose up -d --build`.
4. Back up the `maple-data` volume. It contains SQLite, avatars and task artifacts.

Caddy terminates TLS. Maple only trusts proxy IP headers because the Server is isolated on the internal Docker network. The public URL, allowed Origin and Secure Cookie settings must use the same HTTPS domain.

Windows users install the CLI with:

```powershell
irm https://maple.example.com/install.ps1 | iex
```

macOS and Linux users install it with:

```sh
curl -fsSL https://maple.example.com/install.sh | sh
```
