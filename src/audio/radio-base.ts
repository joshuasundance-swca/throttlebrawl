// The base pack's radio stations, loaded on demand. index.ts imports this file dynamically the
// first time a station is picked without stations handed in, so the start tap never pays for it,
// and the offline browser harnesses (which hand stations in) never load content/.
import { loadBasePack } from '../content';
import { stationsFromTable, type RadioStation } from './radio';

export function baseStations(): RadioStation[] {
  return stationsFromTable(loadBasePack().stations);
}
