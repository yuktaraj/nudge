# Supabase AI Parsing Setup

1. Apply the database migration in your Supabase project.

```sh
supabase db push
```

2. Set Edge Function secrets.

```sh
supabase secrets set GEMINI_API_KEY=...
supabase secrets set SERVICE_ROLE_KEY=...
supabase secrets set PARSER_WORKER_URL=http://localhost:8787
```

3. Deploy the functions.

```sh
supabase functions deploy create-upload
supabase functions deploy process-source
supabase functions deploy get-source-assets
supabase functions deploy delete-source
supabase functions deploy create-recovery-code
supabase functions deploy redeem-recovery-code
```

4. Add Expo public config in `.env`.

```sh
EXPO_PUBLIC_SUPABASE_URL=...
EXPO_PUBLIC_SUPABASE_ANON_KEY=...
```

5. Enable Email auth in Supabase Authentication settings.

6. Apply the ownership migration before deploying the functions:

```sh
supabase db push
```

The Edge Functions validate the user's access token and scope sources to that
user. Existing single-user rows without a `user_id` are intentionally not
assigned to any account; migrate them manually if they should be retained.

The migrations create the parsing tables, enable pgvector, create the
`study-materials` bucket, and add ownership policies for authenticated users.
