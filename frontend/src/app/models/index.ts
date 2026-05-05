export type TipoTimbratura = 'entrata' | 'uscita';
export type StatoRequest = 'pendente' | 'approvata' | 'rifiutata';
export type TipoRequest = 'timbratura' | 'reset_biometria';

export interface Timbratura {
  userId: string;
  timestamp: string;
  data: string;
  tipo: TipoTimbratura;
  stationId: string;
  stazioneDescrizione: string;
  nome: string;
  cognome: string;
}

export interface RichiestaManuale {
  requestId: string;
  userId: string;
  nomeUtente: string;
  nota: string;
  stato: StatoRequest;
  tipoRichiesta: TipoRequest;
  createdAt: string;
  data?: string;
  tipo?: TipoTimbratura;
  ora?: string;
  approvataDa?: string;
  approvataAt?: string;
  motivoRifiuto?: string;
}

export interface Utente {
  id: string;
  email: string;
  given_name: string;
  family_name: string;
  birthdate?: string;
  codice_fiscale?: string;
  password_changed?: string;
  biometrics_reg?: string;
}

export interface Contratto {
  contractId: string;
  userId: string;
  dataInizio: string;
  dataFine?: string;
  tipoContratto: string;
  oreSett?: number;
  giorniSett?: number;
  retribuzioneLorda?: number;
  retribuzioneNetta?: number;
  livello?: string;
  mansione?: string;
  ccnl?: string;
  periodoDiProva?: number;
  giorniFerie?: number;
  permessiOre?: number;
  note?: string;
  createdAt: string;
}

export interface Stazione {
  stationId: string;
  descrizione: string;
  codice: string;
  lat?: number | null;
  lng?: number | null;
  lastSeen?: string;
  createdAt: string;
  isActive?: boolean;
}

export interface StazioneQrResponse {
  qrUrl: string;
  expiresAt: number;
  presenti: number;
  lat: number | null;
  lng: number | null;
  ultimaTimbratura: Timbratura | null;
}

export interface AnteprimaResponse {
  tipo: TipoTimbratura;
  confirmToken: string;
  nome: string;
  cognome: string;
  timestamp: string;
}

export interface ConfermaResponse {
  message: string;
  durataMinuti?: number;
}

export interface DashboardStazione extends Stazione {
  presenti: number;
  timbrature: Timbratura[];
}

export interface CreaUtenteInput {
  email: string;
  nome: string;
  cognome: string;
  birthdate?: string;
  codice_fiscale?: string;
  ruolo?: 'manager' | 'employee';
}

export interface CreaRequestInput {
  data?: string;
  tipo?: TipoTimbratura;
  ora?: string;
  nota: string;
  tipoRichiesta?: TipoRequest;
}
