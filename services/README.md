# Optional services

[OpenH3 Gateway](openh3-gateway/README.md) is a separately deployed Cloudflare Worker that proxies provider requests. Desktop development can use a user-configured provider without deploying it.

The gateway example is not a complete public multi-user service: configure caller access control, quotas and rate limits before public use. Provider credentials belong in server secrets. See the service README for deployment details.
