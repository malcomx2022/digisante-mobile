import { Nkyinkyim } from '@digisante/web';

// Séparateur adinkra — remplace tout <hr> plat.
export const Separateur = () => (
  <div className="w-80 p-5 bg-creme">
    <p className="font-display font-extrabold text-nuit m-0">Mes rendez-vous</p>
    <Nkyinkyim className="my-3" />
    <p className="font-display font-extrabold text-nuit m-0">Mes ordonnances</p>
  </div>
);
