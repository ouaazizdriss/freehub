import "server-only";
import type { CurrentUser } from "@/lib/auth/dal";
import { db } from "@/lib/db";
import { missionCapacity, type AbsenceKind, type Range } from "@/lib/domain/absences";
import { daysInMonth, isoDate, type IsoDate } from "@/lib/domain/calendar";
import { fromIso, holidaysFor, toIso } from "./cra-editor";
import { missionScope } from "./referential";

export type AbsenceRow = { id: string; kind: AbsenceKind; start: IsoDate; end: IsoDate; comment: string | null };

const toRow = (a: { id: string; kind: AbsenceKind; startDate: Date; endDate: Date; comment: string | null }): AbsenceRow => ({
  id: a.id,
  kind: a.kind,
  start: toIso(a.startDate),
  end: toIso(a.endDate),
  comment: a.comment,
});

/** Absences du freelance connecté (les plus récentes d'abord). */
export async function myAbsences(user: CurrentUser) {
  const rows = await db.absence.findMany({
    where: { freelancer: { userId: user.id } },
    orderBy: { startDate: "desc" },
    take: 100,
    select: { id: true, kind: true, startDate: true, endDate: true, comment: true },
  });
  return rows.map(toRow);
}

/**
 * Tableau des absences du mois (Gantt + impact capacitaire), dans le périmètre :
 * freelance → lui-même ; manager → les freelances de ses missions ; admin → tous.
 * Un manager ne voit des absences que la partie qui tombe pendant le rattachement du freelance
 * à l'une de ses missions (pas d'arrêt maladie d'une autre mission), et jamais les commentaires.
 */
export async function absenceBoard(user: CurrentUser, year: number, month1: number) {
  const firstIso = isoDate(year, month1, 1);
  const lastIso = isoDate(year, month1, daysInMonth(year, month1));
  const first = fromIso(firstIso);
  const last = fromIso(lastIso);
  const inMonth = { startDate: { lte: last }, endDate: { gte: first } };
  const contractWhere =
    user.role === "FREELANCE"
      ? { ...inMonth, freelancer: { userId: user.id } }
      : { ...inMonth, mission: missionScope(user), freelancer: { user: { active: true } } };

  const contracts = await db.contract.findMany({
    where: contractWhere,
    select: {
      freelancerId: true,
      startDate: true,
      endDate: true,
      freelancer: {
        select: {
          user: { select: { name: true } },
          absences: { where: inMonth, orderBy: { startDate: "asc" }, select: { id: true, kind: true, startDate: true, endDate: true } },
        },
      },
      mission: { select: { id: true, name: true, country: true } },
    },
  });

  const clip = (r: Range, p: Range): Range | null => {
    const start = r.start > p.start ? r.start : p.start;
    const end = r.end < p.end ? r.end : p.end;
    return start <= end ? { start, end } : null;
  };

  type Person = { id: string; name: string; missions: Set<string>; periods: Range[]; absences: Map<string, AbsenceRow> };
  const people = new Map<string, Person>();
  const missions = new Map<string, { id: string; name: string; country: string; members: Map<string, { freelancerId: string; name: string; periods: Range[]; absences: Range[] }> }>();

  for (const c of contracts) {
    const period = clip({ start: toIso(c.startDate), end: toIso(c.endDate) }, { start: firstIso, end: lastIso })!;
    const absences = c.freelancer.absences.map((a) => toRow({ ...a, comment: null }));
    const person: Person = people.get(c.freelancerId) ?? { id: c.freelancerId, name: c.freelancer.user.name, missions: new Set(), periods: [], absences: new Map() };
    person.missions.add(c.mission.name);
    person.periods.push(period);
    for (const a of absences) {
      // Freelance : ses absences entières ; manager/admin : bornées à la période de rattachement.
      const visible = user.role === "FREELANCE" ? a : clip(a, period) && { ...a, ...clip(a, period)! };
      if (visible) person.absences.set(`${a.id}:${visible.start}`, visible);
    }
    people.set(c.freelancerId, person);

    const mission = missions.get(c.mission.id) ?? { ...c.mission, members: new Map() };
    const member: { freelancerId: string; name: string; periods: Range[]; absences: Range[] } = mission.members.get(c.freelancerId) ?? { freelancerId: c.freelancerId, name: c.freelancer.user.name, periods: [], absences };
    member.periods.push(period);
    mission.members.set(c.freelancerId, member);
    missions.set(c.mission.id, mission);
  }

  // Capacité calculée avec le calendrier de fériés du pays de chaque mission.
  const capacity = await Promise.all(
    [...missions.values()].map(async (m) => {
      const holidays = new Set((await holidaysFor(m.country, year, month1)).map((h) => h.date));
      return missionCapacity({ year, month1, holidays, missions: [{ id: m.id, name: m.name, members: [...m.members.values()] }] })[0];
    }),
  );

  return {
    rows: [...people.values()]
      .map((p) => ({
        id: p.id,
        name: p.name,
        missions: [...p.missions].join(", "),
        absences: [...p.absences.values()].sort((a, b) => a.start.localeCompare(b.start)),
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "fr")),
    capacity: capacity.sort((a, b) => b.ratio - a.ratio),
  };
}
