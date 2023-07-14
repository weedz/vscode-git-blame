const formatter = new Intl.RelativeTimeFormat(undefined, {
    numeric: "auto"
});

const DIVISIONS: Array<{amount: number, name: Intl.RelativeTimeFormatUnit}> = [
    { amount: 60, name: "seconds" },
    { amount: 60, name: "minutes" },
    { amount: 24, name: "hours" },
    { amount: 7, name: "days" },
    { amount: 4.34524, name: "weeks" },
    { amount: 12, name: "months" },
    { amount: Number.POSITIVE_INFINITY, name: "years" }
];

export function formatTimeAgo(date: Date) {
    let duration = (date.getTime() - new Date().getTime()) / 1000;
    for (const division of DIVISIONS) {
        if (Math.abs(duration) < division.amount) {
            return formatter.format(Math.round(duration), division.name);
        }
        duration /= division.amount;
    }
    // NOTE: Should never reach this
    return formatter.format(Math.round(duration), "seconds");
}
