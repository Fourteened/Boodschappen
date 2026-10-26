# Boodschappen

Gedeelde boodschappenlijst en weekmenu voor iedereen in huis. Inloggen met Microsoft, live bijgewerkt via Supabase Realtime, draait op Vercel en is als app op je telefoon te zetten.

## Stack

- **Next.js 16** (App Router) op **Vercel**
- **Supabase**: database, Microsoft-login (Azure-provider) en Realtime
- PWA: manifest + service worker, installeerbaar op iPhone en Android

## Wat zit erin

- **Lijst**: toevoegen met aantal, afvinken, "vaak gekocht"-suggesties, mandje legen. Wijzigingen van huisgenoten verschijnen direct.
- **Weekmenu**: per dag wat je eet, met vorige/volgende week.
- **Huis**: wie er meedoet, uitnodigingslink delen, uitloggen.

## Database

Supabase-project `boodschappen` (regio eu-central-1). Tabellen in `public`:

| Tabel | Inhoud |
| --- | --- |
| `profiles` | naam en e-mail, automatisch aangemaakt bij eerste login |
| `households` | huishouden met uitnodigingscode |
| `household_members` | wie bij welk huishouden hoort |
| `shopping_items` | de lijst; afgevinkte items krijgen `archived_at` als het mandje geleegd wordt |
| `meal_plan` | één gerecht per dag per huishouden |

Row Level Security staat overal aan: je ziet alleen gegevens van je eigen huishouden. Aanmaken en meedoen gaat via de functies `create_household` en `join_household`. De SQL staat in `supabase/migrations/`.

## Lokaal draaien

```bash
cp .env.example .env.local
npm install
npm run dev
```

Voeg `http://localhost:3000/**` toe aan de Redirect URLs in Supabase (Authentication → URL Configuration).

## Volgende stap: Picnic

Bestellingen en het mandje uit Picnic ophalen via de onofficiële API (`picnic-api` op npm), in een losse module zodat de lijst blijft werken als Picnic iets verandert.
