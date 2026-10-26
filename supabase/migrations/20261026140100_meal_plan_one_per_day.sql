drop index if exists public.meal_plan_household_day_idx;
alter table public.meal_plan
  add constraint meal_plan_household_day_key unique (household_id, day);
