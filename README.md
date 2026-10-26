# Boodschappen

Voorraad per plek in huis, een bijbestellen-lijst en een weekmenu, gedeeld met iedereen in huis. Inloggen met Microsoft, live bijgewerkt via Supabase Realtime, Picnic-bezorgingen komen er na bezorging bij. Draait op Vercel en is als app op je telefoon te zetten.

## Wat zit erin

- **Voorraad**: producten per plek (Koelkast, Vriezer, Voorraadkast, zelf uit te breiden) met aantal en houdbaarheidsdatum. Bovenaan staat wat eerst op moet.
- **Bijbestellen**: wat op raakt (aantal naar 0) komt hier vanzelf op. Je kunt ook zelf iets toevoegen.
- **Picnic**: koppel je account op de Huis-pagina (één keer inloggen met sms-code). Na een bezorging verschijnt die op de Voorraad-pagina; je kiest per product de plek en eventueel een datum. De app onthoudt de plek voor de volgende keer.
- **Weekmenu**: per dag wat je eet.
- **Huis**: Picnic koppelen, plekken beheren, huisgenoten uitnodigen.

## Stack

- **Next.js 16** (App Router) op **Vercel** (functies in fra1)
- **Supabase**: Postgres met RLS, Microsoft-login (Azure-provider), Realtime en de Edge Function `picnic`
- PWA: manifest + service worker

## Picnic-koppeling

`supabase/functions/picnic` praat met de onofficiële Picnic-API (dezelfde endpoints als de app, zoals beschreven door het open-source project picnic-api). Het wachtwoord wordt niet bewaard; de sessiesleutel staat in `picnic_secrets`, een tabel die alleen de functie (service role) kan lezen. Picnic kan de API zonder aankondiging veranderen; dan werkt de rest van de app gewoon door.

Deployen: `supabase functions deploy picnic --no-verify-jwt` (de functie controleert zelf de Supabase-sessie en het lidmaatschap van het huishouden).

## Database

SQL staat in `supabase/migrations/`. Belangrijkste tabellen: `households`, `household_members`, `locations`, `stock_items`, `shopping_items`, `meal_plan`, `picnic_links`, `picnic_deliveries`, `picnic_delivery_items`, `picnic_products`.

- Valt het aantal van een product naar 0, dan haalt een trigger het uit de voorraad en zet het op de bijbestellen-lijst.
- `confirm_picnic_delivery` zet een gecontroleerde bezorging in één keer in de voorraad.

## Lokaal draaien

```bash
cp .env.example .env.local
npm install
npm run dev
```

Voeg `http://localhost:3000/**` toe aan de Redirect URLs in Supabase (Authentication → URL Configuration).
