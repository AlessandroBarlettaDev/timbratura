# Validazione Geografica

## Il problema

Un sistema di timbratura digitale deve garantire che il dipendente sia fisicamente presente in azienda al momento della timbratura. Con un badge fisico questo è implicito — il lettore si trova fisicamente all'ingresso. Con uno smartphone, il dipendente potrebbe teoricamente timbrare da casa, dall'auto o da qualsiasi luogo.

La validazione geografica risponde a questa esigenza: il backend verifica che la posizione GPS del dipendente sia sufficientemente vicina alla stazione che ha generato il QR.

## La formula di Haversine

La distanza tra due punti sulla superficie terrestre non può essere calcolata con la geometria euclidea perché la Terra è una sfera (o più precisamente, un ellissoide). Per distanze brevi (poche centinaia di metri) la formula di Haversine fornisce un'approssimazione sufficientemente accurata:

```
a = sin²(Δφ/2) + cos(φ₁) · cos(φ₂) · sin²(Δλ/2)
d = 2R · arctan(√a, √(1−a))
```

dove:
- φ = latitudine in radianti
- λ = longitudine in radianti
- R = 6.371.000 m (raggio medio della Terra)
- d = distanza in metri

Implementazione nel backend:

```typescript
export function haversineMeters(
  lat1: number, lng1: number,
  lat2: number, lng2: number
): number {
  const R = 6_371_000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
```

## Come funziona nel sistema

La validazione avviene in `/timbrature/anteprima`:

1. Il backend recupera le coordinate della stazione da DynamoDB (`stazione.lat`, `stazione.lng`)
2. Se la stazione **non ha coordinate** → validazione GPS disabilitata per quella stazione, il flusso continua
3. Se la stazione **ha coordinate** e il dipendente non ha inviato GPS → rifiuto 403
4. Se la stazione **ha coordinate** e la distanza supera 200 m → rifiuto 403

Le coordinate della stazione vengono aggiornate periodicamente dalla stazione stessa tramite `POST /stazioni/me/position`, inviata ad ogni refresh del QR (ogni 3 minuti), se il dispositivo ha il GPS attivo.

## La soglia di 200 metri

La scelta di 200 metri come raggio massimo è un compromesso tra due esigenze opposte:

**Troppo restrittivo (es. 20 m)**: il GPS degli smartphone ha un'accuratezza tipica di 3–10 metri in condizioni ideali (cielo aperto), ma può degradare a 20–50 metri in ambiente urbano con edifici alti, e a 50–100 metri o più in interni. Con una soglia di 20 metri, molti dipendenti verrebbero rifiutati anche stando all'ingresso dell'ufficio.

**Troppo permissivo (es. 500 m)**: un raggio di mezzo chilometro comprende edifici vicini, parcheggi pubblici, caffè adiacenti — aree da cui il dipendente potrebbe timbrare senza essere effettivamente in azienda.

200 metri rappresenta un equilibrio pratico: copre la variabilità del GPS negli interni e nelle aree urbane dense, mentre esclude ragionevolmente chi si trova in luoghi distinti dalla sede.

La soglia non è configurabile per stazione nell'implementazione attuale — è una costante `MAX_DISTANCE_METERS = 200` nel codice. Un'evoluzione possibile sarebbe renderla un attributo della stazione, permettendo configurazioni diverse per sedi in ambienti con GPS più o meno affidabile.

## Limiti della validazione GPS

**GPS indoor**: la maggior parte degli edifici attenua significativamente il segnale GPS. In molti uffici lo smartphone non riesce ad acquisire il GPS o lo acquisisce con errori di decine di metri. Per questo il frontend usa `maximumAge: 30000` (accetta posizioni cached di massimo 30 secondi) e un `timeout` di 8 secondi — se il GPS non risponde, la richiesta parte comunque senza coordinate.

**Conseguenza**: stazioni in ambienti chiusi senza GPS affidabile devono essere create senza coordinate, disabilitando così la validazione geografica. In questi casi la sicurezza si affida esclusivamente alla biometria e al QR.

**Accuratezza variabile**: due letture GPS consecutive dello stesso dispositivo fermo possono differire di 10–30 metri. Un dipendente esattamente a 195 metri potrebbe essere accettato o rifiutato a seconda del momento della lettura.

**Assenza di validazione dell'accuratezza**: il browser fornisce il campo `coords.accuracy` (stima dell'errore in metri) ma il sistema non lo utilizza. Una lettura con accuracy = 150 m potrebbe posizionare il dipendente ovunque in un cerchio di 150 m — ben oltre la soglia di 200 m. Un miglioramento possibile sarebbe rifiutare letture con accuracy troppo alta.

**Spoofing GPS**: applicazioni di spoofing GPS possono inviare coordinate false. Questa vulnerabilità è strutturale in tutti i sistemi basati su GPS lato client. La contromisura principale è che il rischio residuo rimane accettabile in un contesto aziendale: chi usa un'app di spoofing GPS per frodare il sistema di timbratura è già in una posizione di manifesta malafede rilevabile con altri strumenti (telecamere, badge accesso, testimonianze).

## Invio della posizione dalla stazione

La stazione invia periodicamente la propria posizione GPS al backend, permettendo al sistema di tracciare gli spostamenti fisici della stazione (utile se il tablet è mobile) e di mantenere aggiornate le coordinate per la validazione:

```
POST /stazioni/me/position
Authorization: Bearer <jwt-stazione>
{ "lat": 45.4654, "lng": 9.1866 }
→ 200 { "message": "Posizione aggiornata" }
```

Questa chiamata avviene ad ogni refresh del QR (ogni 3 minuti), subito dopo aver ottenuto le nuove coordinate GPS del dispositivo stazione. Se il GPS della stazione non è disponibile, la chiamata non viene effettuata e le coordinate restano invariate.
