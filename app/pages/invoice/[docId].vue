<script setup lang="ts">
const route = useRoute()
const { get } = useApi()
const { money, date } = useFormatters()

type Doc = {
  id: string
  status: string
  supplierNif: string | null
  number: string | null
  issuedAt: string | null
  totalCents: number | null
  qrRaw: string | null
  pages: Array<{ page: number; mime: string }>
}
const id = route.params.docId as string
const duplicate = route.query.duplicate === '1'
const { data: doc, error } = await useAsyncData(`doc-${id}`, () => get<Doc>(`/api/documents/${id}`))
</script>

<template>
  <main class="mx-auto max-w-md p-4">
    <NuxtLink to="/invoice" class="text-sm text-muted underline">Add another</NuxtLink>
    <h1 class="mt-2 text-2xl font-bold text-accent">Invoice</h1>

    <p v-if="error" role="alert" class="mt-4 text-danger">Invoice not found.</p>
    <template v-else-if="doc">
      <p v-if="duplicate" role="status" data-testid="duplicate-notice" class="mt-3 rounded-lg border border-warn/40 bg-warn/10 p-3 text-sm text-warn">
        This invoice was already uploaded
      </p>

      <section class="mt-4 rounded-lg bg-surface p-4" data-testid="invoice-header">
        <span v-if="doc.qrRaw" class="rounded bg-ok/15 px-2 py-0.5 text-xs text-ok" data-testid="qr-badge">From QR code</span>
        <dl class="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          <dt class="text-muted">Supplier NIF</dt>
          <dd data-testid="supplier-nif">{{ doc.supplierNif ?? '—' }}</dd>
          <dt class="text-muted">Number</dt>
          <dd data-testid="invoice-number">{{ doc.number ?? '—' }}</dd>
          <dt class="text-muted">Date</dt>
          <dd>{{ doc.issuedAt ? date(doc.issuedAt) : '—' }}</dd>
          <dt class="text-muted">Total</dt>
          <dd data-testid="invoice-total">{{ doc.totalCents != null ? money(doc.totalCents) : '—' }}</dd>
        </dl>
      </section>

      <ul class="mt-4 grid grid-cols-3 gap-2" data-testid="thumbnails">
        <li v-for="p in doc.pages" :key="p.page">
          <img
            v-if="p.mime.startsWith('image/')"
            :src="`/api/documents/${doc.id}/files/${p.page}`"
            :alt="`Page ${p.page}`"
            class="aspect-[3/4] w-full rounded-lg object-cover"
          >
          <a
            v-else
            :href="`/api/documents/${doc.id}/files/${p.page}`"
            target="_blank"
            class="flex aspect-[3/4] items-center justify-center rounded-lg bg-surface text-sm text-muted"
          >
            PDF
          </a>
        </li>
      </ul>
    </template>
  </main>
</template>
