import { requireHousehold } from "@/lib/household";
import { addDays, isIsoDate, isoWeekNumber, mondayOf, todayInAmsterdam } from "@/lib/dates";
import { WeekMenu, type Meal } from "./week-menu";

export default async function WeekMenuPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  const { week } = await searchParams;
  const { supabase, household } = await requireHousehold();

  const today = todayInAmsterdam();
  const start = mondayOf(isIsoDate(week) ? week : today);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));

  const { data } = await supabase
    .from("meal_plan")
    .select("id, day, title, notes")
    .eq("household_id", household.id)
    .gte("day", days[0])
    .lte("day", days[6])
    .order("day", { ascending: true });

  return (
    <WeekMenu
      key={start}
      householdId={household.id}
      days={days}
      today={today}
      weekNumber={isoWeekNumber(start)}
      prevWeek={addDays(start, -7)}
      nextWeek={addDays(start, 7)}
      isCurrentWeek={start === mondayOf(today)}
      initialMeals={(data ?? []) as Meal[]}
    />
  );
}
