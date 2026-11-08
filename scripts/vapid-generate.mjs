// Prints a fresh VAPID key pair for Web Push. Copy the lines into your
// environment yourself; this script never writes any file.
import webpush from 'web-push'

const { publicKey, privateKey } = webpush.generateVAPIDKeys()
console.log(`NUXT_VAPID_PUBLIC_KEY=${publicKey}`)
console.log(`NUXT_VAPID_PRIVATE_KEY=${privateKey}`)
console.log('NUXT_VAPID_SUBJECT=mailto:you@example.com')
