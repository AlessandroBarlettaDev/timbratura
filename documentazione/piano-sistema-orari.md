# Piano: Sistema Template Orari

## Context

Il sistema di timbratura attuale non ha nessuna logica di orari previsti: `calcolaTipo()` usa solo la soglia fissa `TURNO_MAX_ORE=20`. I campi `oreSett`/`giorniSett` del contratto sono usati solo per l'export Excel. L'obiettivo è aggiungere template orari configurabili dal manager con cascata di priorità, rotazione giornaliera e avviso anomalie visibile solo al manager.

**Decisioni chiave:**
- Anomalie: solo badge/avviso nella vista timbrature del manager, dipendente non vede nulla
- Rotazione: giornaliera (`daysSinceStart % templates.length`)
- Gruppi di lavoro: nuovi gruppi Cognito creabili dal manager nell'app

---

## Nuove tabelle DynamoDB

### `ScheduleTemplates`
```
PK: templateId (STRING)
Fields: nome, tipo ('fisso'|'flessibile'|'turno'), giorni (number[]),
        oraEntrata, oraEntrataMax, oraUscitaMin (HH:mm strings),
        minutiMinimi (number), tolleranzaMinuti (number), createdAt
```
Nessun GSI — scan accettabile (decine di template al massimo).

### `ScheduleAssignments`
```
PK: assignmentId (STRING)
GSI "target-index": PK=targetType (STRING), SK=targetId (STRING)
Fields: targetType ('user'|'cognitoGroup'|'contractType'), targetId,
        schedule: { type:'static', templateId } |
                  { type:'rotating', templates: string[], startDate: YYYY-MM-DD } |
                  { type:'free' },
        dataInizio, dataFine (nullable), createdAt
```
Un GSI copre tutti e tre i lookup della cascata.

**File da modificare:** `backend/lib/config/dynamodb.ts`

---

## File da creare/modificare

### NUOVO: `backend/lib/lambda/schedule-resolver.ts`
Funzione shared `resolveSchedule()` importata da `schedules-handler` e `timbrature-handler`.

**Algoritmo cascata:**
```
resolveSchedule(userId, date):
  1. query target-index (targetType='user', targetId=userId)
     → match attivo? se type='free' → null; altrimenti → ritorna template risolto
  2. query target-index per ogni gruppo Cognito dell'utente
     → primo match attivo? → ritorna template risolto
  3. query target-index (targetType='contractType', targetId=contratto.tipoContratto)
     → match attivo? → ritorna template risolto
  4. → null (tracciamento libero)
```

**Risoluzione rotazione giornaliera:**
```
index = Math.floor(daysDiff(startDate, date)) % templates.length
return getTemplate(templates[index])
```
> Nota: la rotazione avanza su tutti i giorni di calendario (inclusi weekend). Se una template ha `giorni=[1,2,3,4,5]`, il giorno di calendario conta comunque nell'indice — weekend compresi.

**Helper `findActiveAssignment`:** filtra per `dataInizio <= date` e `(dataFine IS NULL OR dataFine >= date)`.

**Helper `getActiveContract`:** query su `userId-index` della tabella Contracts, filtra per date attive, prende il più recente.

---

### NUOVO: `backend/lib/lambda/schedules-handler.ts`
Seguire il pattern di `contracts-handler.ts` (dispatch su `httpMethod+resource`, helper `json()`).

**Routes (tutti Cognito-auth):**
```
GET/POST   /schedules/templates          [manager]
GET/PUT/DELETE /schedules/templates/{id} [manager]
GET/POST   /schedules/assignments        [manager]
GET/PUT/DELETE /schedules/assignments/{id} [manager]
GET        /schedules/me                 [employee + manager]
GET        /schedules/users/{userId}     [manager]
```

- `deleteTemplate`: ritornare 409 se esistono assignments che usano quel templateId
- `listAssignments`: accetta `?targetType=&targetId=` per filtrare via GSI; senza params → scan
- `getMySchedule` / `getUserSchedule`: chiama `resolveSchedule()`, arricchisce con template e `resolvedVia`

**Env vars necessari:**
```
SCHEDULE_TEMPLATES_TABLE_NAME
SCHEDULE_ASSIGNMENTS_TABLE_NAME
CONTRACTS_TABLE_NAME
USER_POOL_ID
```

---

### MODIFICA: `backend/lib/lambda/users-handler.ts`
Aggiungere gestione gruppi Cognito (creazione/lista/membership).

**Nuove routes:**
```
GET    /groups              → listGroups()    [manager] — Cognito ListGroups
POST   /groups              → createGroup()   [manager] — Cognito CreateGroup
DELETE /groups/{name}       → deleteGroup()   [manager] — Cognito DeleteGroup (solo se nessun membro)
POST   /users/{id}/groups/{groupName}   → addUserToGroup()    [manager]
DELETE /users/{id}/groups/{groupName}  → removeUserFromGroup() [manager]
GET    /users/{id}/groups   → listUserGroups() [manager]
```
Usare `AdminAddUserToGroup`, `AdminRemoveUserFromGroup`, `AdminListGroupsForUser`, `ListGroups`.

**IAM aggiuntivo per usersHandler:**
```
cognito-idp:CreateGroup
cognito-idp:DeleteGroup
cognito-idp:ListGroups
cognito-idp:AdminAddUserToGroup
cognito-idp:AdminRemoveUserFromGroup
```

---

### MODIFICA: `backend/lib/lambda/timbrature-handler.ts`
Solo `confermaTimbratura()` cambia.

**Aggiunta dopo il `PutItemCommand` definitivo (non-blocking try/catch):**
```typescript
let anomalia: string | null = null;
try {
  const resolved = await resolveSchedule(...);
  if (resolved) {
    const isoDay = getIsoWeekday(pending.data);
    if (!resolved.template.giorni.includes(isoDay)) {
      anomalia = 'giorno_non_previsto';
    } else {
      // convert timestamp UTC → HH:mm locale (Europe/Rome, senza toLocaleString)
      const localHHMM = utcToLocalHHMM(timestamp);
      if (tipoFinale === 'entrata' && localHHMM > resolved.template.oraEntrataMax)
        anomalia = 'entrata_in_ritardo';
      if (tipoFinale === 'uscita' && localHHMM < resolved.template.oraUscitaMin)
        anomalia = 'uscita_anticipata';
    }
    if (anomalia) {
      await UpdateItemCommand sul record appena salvato → SET anomalia = :a
    }
  }
} catch (e) { console.error('resolveSchedule non-blocking error', e); }

return json(200, { tipo, timestamp, nome, cognome, durataMinuti, anomalia });
```
**Conversione fuso orario:** usare offset `Europe/Rome` calcolato con `Intl.DateTimeFormat` (già usato in `requests-handler.ts`), non `toLocaleString`.

**IAM aggiuntivo per timbratureHandler:**
```
dynamo.scheduleTemplatesTable.grantReadData(timbratureHandler)
dynamo.scheduleAssignmentsTable.grantReadData(timbratureHandler)
dynamo.contractsTable.grantReadData(timbratureHandler)
cognito-idp:AdminListGroupsForUser (grant sull'userPool)
```

---

### MODIFICA: `backend/lib/config/api.ts`
Nuovo metodo `addSchedulesRoutes(handler)` + nuove routes in `addUsersRoutes`:
```
/groups, /groups/{name}
/users/{id}/groups, /users/{id}/groups/{groupName}
```

### MODIFICA: `backend/lib/backend-stack.ts`
- Istanziare `schedulesHandler` (NodejsFunction, env vars, grants)
- Aggiungere env vars a `timbratureHandler` e `usersHandler`
- Aggiungere IAM grants
- Chiamare `api.addSchedulesRoutes(schedulesHandler)`

---

## Frontend

### `frontend/src/app/services/api.service.ts`
Aggiungere metodi per tutti gli endpoint nuovi:
- `getScheduleTemplates()`, `createScheduleTemplate()`, `updateScheduleTemplate()`, `deleteScheduleTemplate()`
- `getScheduleAssignments()`, `createScheduleAssignment()`, `updateScheduleAssignment()`, `deleteScheduleAssignment()`
- `getMySchedule()`, `getUserSchedule(userId)`
- `getGroups()`, `createGroup(nome)`, `deleteGroup(nome)`
- `addUserToGroup(userId, groupName)`, `removeUserFromGroup(userId, groupName)`, `listUserGroups(userId)`

### `frontend/src/app/components/dashboard-manager/dashboard-manager.ts`
1. Estendere `Section` type: aggiungere `'orari'` e `'gruppi'`
2. Aggiungere state per templates, assignments, gruppi Cognito
3. Aggiungere metodi: `loadScheduleTemplates()`, `loadScheduleAssignments()`, `loadGroups()`, `loadUserSchedule(userId)` (chiamato dentro `selectUser()`)
4. Chiamare `loadUserSchedule()` nel pannello dettaglio utente
5. Reset `selectedUserSchedule = null` in `backToList()`

### `frontend/src/app/components/dashboard-manager/dashboard-manager.html`
1. **Sidebar:** aggiungere 2 nav button: "Orari" e "Gruppi"
2. **Sezione Orari:** sub-tab Templates + Assignments
   - Templates: tabella (nome, tipo, giorni, finestra oraria, tolleranza) + create/edit/delete modal
   - Assignments: tabella (target, tipo schedule, periodo) + create modal con selezione targetType/targetId/schedule
3. **Sezione Gruppi:** lista gruppi Cognito + crea/elimina + gestione membership (add/remove utente da gruppo)
4. **Pannello utente:** aggiungere "Orario assegnato" card (template risolto + `resolvedVia`)
5. **Vista timbrature utente:** badge anomalia `!` su righe con `t.anomalia` non null (tooltip con il codice)

### `frontend/src/app/components/dashboard-employee/dashboard-employee.ts`
Chiamare `getMySchedule()` in `ngOnInit()`, mostrare in un info-bar "Oggi: HH:MM – HH:MM" se schedule non null.

---

## Ordine di implementazione

**Fase 1 — Infrastructure (deploy-safe, nessun impatto runtime)**
1. `dynamodb.ts`: aggiungere 2 tabelle
2. `backend-stack.ts`: stub Lambda schedulesHandler (501) + grants
3. `api.ts`: `addSchedulesRoutes()` + nuove routes utenti/gruppi
4. `backend-stack.ts`: aggiungere env vars a timbratureHandler e usersHandler
5. `cdk deploy`

**Fase 2 — Core backend**
6. `schedule-resolver.ts`: scrivere `resolveSchedule()` + helpers
7. `schedules-handler.ts`: tutti i route CRUD + resolution
8. `users-handler.ts`: aggiungere routes gruppi Cognito
9. `cdk deploy` + test endpoint via curl

**Fase 3 — Anomaly integration**
10. `timbrature-handler.ts`: aggiungere blocco anomalia in `confermaTimbratura()`
11. `cdk deploy` + verifica che flag appaiono sulle timbrature

**Fase 4 — Frontend**
12. `api.service.ts`: tutti i metodi nuovi
13. `dashboard-manager.ts`: state + metodi
14. `dashboard-manager.html`: sezioni Orari e Gruppi + badge anomalia
15. `dashboard-employee`: info-bar orario di oggi

---

## Verifica end-to-end
1. Manager crea template "Mattina" (08:00–17:00, lun-ven)
2. Manager crea gruppo Cognito "produzione-a", aggiunge un dipendente
3. Manager crea assignment: `cognitoGroup:produzione-a → static:Mattina`
4. Dipendente timbra alle 09:30 → anomalia `entrata_in_ritardo` salvata
5. Manager vede badge `!` sulla timbratura delle 09:30
6. Manager crea assignment rotating: `cognitoGroup:produzione-a → rotating:[mattina-id, pomeriggio-id, notte-id], startDate: oggi`
7. Verificare che oggi = template[0], domani = template[1], etc.
8. Employee dashboard mostra "Oggi: 08:00 – 17:00"
