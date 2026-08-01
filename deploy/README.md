# Maple hosted deployment

1. Point the selected domain's A/AAAA record at the host.
2. Copy `deploy/.env.example` to `.env` and set `MAPLE_DOMAIN`.
3. Run `docker compose up -d --build`.
4. Back up the `maple-data` volume. It contains SQLite, the generated Provider encryption key, avatars and task artifacts.

Caddy terminates TLS. Maple only trusts proxy IP headers because the Server is isolated on the internal Docker network. The public URL, allowed Origin and Secure Cookie settings must use the same HTTPS domain.

DeepSeek can be connected from the hosted dashboard. By default Maple creates a persistent encryption key inside `maple-data` and stores only AES-GCM ciphertext in SQLite. Multi-instance deployments should set the same 32-byte base64url `MAPLE_PROVIDER_CREDENTIAL_KEY` on every Server replica. Setting `DEEPSEEK_API_KEY` makes the credential deployment-managed instead of dashboard-managed.

Windows users install the CLI with:

```powershell
irm https://maple.example.com/install.ps1 | iex
```

macOS and Linux users install it with:

```sh
curl -fsSL https://maple.example.com/install.sh | sh
```
