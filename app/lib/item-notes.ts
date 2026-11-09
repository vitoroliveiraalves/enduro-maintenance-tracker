/** A rider's note on a maintenance item, as GET /api/items/:id/notes returns it. */
export type ItemNoteJson = {
  id: string
  title: string
  body: string
  specs: Array<{ label: string; value: string }>
  photos: Array<{ id: string }>
  updatedAt: string
}

export const notePhotoUrl = (noteId: string, photoId: string) => `/api/notes/${noteId}/photos/${photoId}`
