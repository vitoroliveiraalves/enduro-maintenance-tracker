import type { Bike } from '../db/schema'
import { bikeDetail } from './bikes'
import { listServices } from './services'

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

const fmtMoney = (cents: number) => `${(cents / 100).toFixed(2).replace('.', ',')} €`
const fmtHours = (h: number) => `${(h / 10).toFixed(1)} h`
const fmtKm = (k: number) => `${k.toLocaleString('fr-FR')} km`
const fmtVol = (ml: number) => (ml < 1000 ? `${ml} ml` : `${(ml / 1000).toFixed(ml % 100 === 0 ? 1 : 2)} L`)

function slug(name: string): string {
  const s = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return s || 'vehicle'
}

/** Build a self-contained printable HTML service book dossier for one owned vehicle. */
export async function buildVehicleDossierHtml(bike: Bike): Promise<{ fileName: string; html: string }> {
  const [detail, svcs] = await Promise.all([
    bikeDetail(bike),
    listServices(bike.userId, { bikeId: bike.id }),
  ])

  const generatedAt = new Date().toISOString().slice(0, 10)
  const fileName = `${slug(bike.name)}-service-book-${generatedAt}.html`

  const metersText = [
    detail.latestReading?.hoursTenths != null ? fmtHours(detail.latestReading.hoursTenths) : null,
    detail.latestReading?.km != null ? fmtKm(detail.latestReading.km) : null,
  ]
    .filter(Boolean)
    .join(' · ') || '—'

  const metaParts = [
    [bike.make, bike.model].filter(Boolean).join(' '),
    String(bike.year),
    bike.vehicleType === 'car' ? 'Car' : bike.stroke,
    bike.plate ? `Plate ${bike.plate}` : null,
  ].filter(Boolean)

  const scheduleRows = detail.items
    .map((it) => {
      const iv = [
        it.def.everyHoursTenths ? fmtHours(it.def.everyHoursTenths) : null,
        it.def.everyKm ? fmtKm(it.def.everyKm) : null,
        it.def.everyMonths ? `${it.def.everyMonths} mo` : null,
      ]
        .filter(Boolean)
        .join(' / ') || '—'
      const last = it.last
        ? [
            it.last.dateUnknown ? 'Date unknown' : it.last.at.toISOString().slice(0, 10),
            it.last.hoursTenths != null ? fmtHours(it.last.hoursTenths) : null,
            it.last.km != null ? fmtKm(it.last.km) : null,
          ]
            .filter(Boolean)
            .join(' · ')
        : 'Not logged'
      return `<tr>
        <td><strong>${esc(it.name)}</strong></td>
        <td>${esc(iv)}</td>
        <td><span class="badge badge-${esc(it.status.state)}">${esc(it.status.state.toUpperCase())}</span></td>
        <td>${esc(last)}</td>
      </tr>`
    })
    .join('')

  const flatSpecs = detail.specs.flatMap((n) =>
    n.specs
      .filter((s) => s.label.trim() || s.value.trim())
      .map((s) => ({ itemName: n.itemName, label: s.label, value: s.value })),
  )

  const specsSection = flatSpecs.length
    ? `<section>
        <h2>Specs &amp; Torques</h2>
        <table>
          <thead><tr><th>System</th><th>Spec</th><th>Value</th></tr></thead>
          <tbody>
            ${flatSpecs
              .map(
                (s) => `<tr><td>${esc(s.itemName)}</td><td>${esc(s.label)}</td><td><strong>${esc(s.value)}</strong></td></tr>`,
              )
              .join('')}
          </tbody>
        </table>
      </section>`
    : ''

  const totalSpend = svcs.reduce((sum, s) => sum + s.totalCents, 0)

  const historyRows = svcs.length
    ? svcs
        .map((s) => {
          const kindLabel = s.topUp ? `Top-up${s.topUpMl ? ` (${fmtVol(s.topUpMl)})` : ''}` : 'Service'
          const meters = [
            s.hoursTenths != null ? fmtHours(s.hoursTenths) : null,
            s.km != null ? fmtKm(s.km) : null,
          ]
            .filter(Boolean)
            .join(' · ') || '—'
          const byText = s.by === 'garage' ? (s.garageName ? `Garage · ${s.garageName}` : 'Garage') : 'DIY'
          const partsText = s.partsUsed.length
            ? s.partsUsed.map((p) => `${(p.qtyHundredths / 100).toString()} ${p.unit} ${p.name}`).join(', ')
            : ''
          const details = [partsText, s.notes && s.notes !== 'Initial' ? s.notes : ''].filter(Boolean).join(' — ')
          return `<tr>
            <td class="nowrap">${esc(s.atUnknown ? 'Unknown' : s.at)}</td>
            <td><span class="badge ${s.topUp ? 'badge-topup' : 'badge-service'}">${esc(kindLabel)}</span></td>
            <td class="nowrap">${esc(meters)}</td>
            <td><strong>${esc(s.itemNames.join(', ') || 'Service')}</strong>${details ? `<div class="sub">${esc(details)}</div>` : ''}</td>
            <td>${esc(byText)}</td>
            <td class="num nowrap">${s.totalCents ? esc(fmtMoney(s.totalCents)) : '—'}</td>
          </tr>`
        })
        .join('')
    : `<tr><td colspan="6" class="empty">No services logged yet.</td></tr>`

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(bike.name)} — Service Book</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; margin: 24px auto; max-width: 900px; padding: 0 16px; color: #111827; line-height: 1.45; }
  header { border-bottom: 2px solid #111827; padding-bottom: 14px; margin-bottom: 22px; display: flex; flex-wrap: wrap; justify-content: space-between; gap: 12px; align-items: flex-end; }
  h1 { margin: 0; font-size: 26px; letter-spacing: -0.02em; text-transform: uppercase; }
  .meta { color: #4b5563; font-size: 13px; margin-top: 4px; }
  .stats { text-align: right; font-size: 13px; }
  .stats strong { display: block; font-size: 16px; }
  h2 { font-size: 13px; text-transform: uppercase; letter-spacing: 0.08em; color: #374151; margin: 22px 0 8px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { border-bottom: 1px solid #e5e7eb; padding: 8px 10px; text-align: left; vertical-align: top; }
  th { font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: #6b7280; background: #f9fafb; }
  .num { text-align: right; }
  .nowrap { white-space: nowrap; }
  .sub { color: #4b5563; font-size: 12px; margin-top: 2px; }
  .empty { text-align: center; color: #6b7280; padding: 18px; }
  .badge { display: inline-block; padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: 700; letter-spacing: 0.04em; background: #f3f4f6; color: #374151; }
  .badge-overdue { background: #fee2e2; color: #991b1b; }
  .badge-soon { background: #fef3c7; color: #92400e; }
  .badge-ok { background: #dcfce7; color: #166534; }
  .badge-topup { background: #dbeafe; color: #1e40af; }
  .badge-service { background: #f3f4f6; color: #111827; }
  footer { margin-top: 26px; padding-top: 12px; border-top: 1px solid #e5e7eb; display: flex; justify-content: space-between; font-size: 12px; color: #6b7280; }
  @media print { body { margin: 0; max-width: none; } section { break-inside: avoid; } }
</style>
</head>
<body>
  <header>
    <div>
      <h1>${esc(bike.name)}</h1>
      <div class="meta">${esc(metaParts.join(' · '))}</div>
    </div>
    <div class="stats">
      <strong>${esc(metersText)}</strong>
      <span>Generated ${esc(generatedAt)}</span>
    </div>
  </header>

  <section>
    <h2>Maintenance Schedule</h2>
    <table>
      <thead><tr><th>Item</th><th>Interval</th><th>Status</th><th>Last Full Service</th></tr></thead>
      <tbody>${scheduleRows || '<tr><td colspan="4" class="empty">No maintenance items.</td></tr>'}</tbody>
    </table>
  </section>

  ${specsSection}

  <section>
    <h2>Service &amp; Top-Up History</h2>
    <table>
      <thead><tr><th>Date</th><th>Type</th><th>Meters</th><th>Items &amp; Details</th><th>By</th><th class="num">Cost</th></tr></thead>
      <tbody>${historyRows}</tbody>
    </table>
  </section>

  <footer>
    <span>Dirt Garage Service Book</span>
    <span>Total recorded service spend: <strong>${esc(fmtMoney(totalSpend))}</strong></span>
  </footer>
</body>
</html>`

  return { fileName, html }
}
