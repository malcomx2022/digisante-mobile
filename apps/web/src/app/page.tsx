import { Badge, BottomNav, Button, CardPagne, KenteBar, Nkyinkyim, StatusBar } from '@/components/ui';

// Vitrine du design system « Wax & Terre » (thème PATIENT).
// Sert de référence visuelle ; remplacée par les écrans D-01→D-26 ensuite.
export default function Home() {
  return (
    <div className="min-h-screen wax-light">
      <div className="mx-auto max-w-[420px] min-h-screen bg-creme flex flex-col shadow-xl">
        {/* Header sombre patient : bogolan + kenté en bas */}
        <header className="bg-sante-900 bogolan-dark relative pb-16 text-white">
          <StatusBar dark lang="FR" />
          <div className="px-6 pt-2">
            <p className="text-[12px] text-white/70 font-body">Kú dó gbɛ̀ 👋</p>
            <h1 className="font-display font-extrabold text-2xl">Bonjour, Koffi</h1>
            <p className="text-[12px] text-white/70 mt-1">🗣 Fon · Français</p>
          </div>
          <KenteBar className="absolute bottom-0 left-0 right-0" />
        </header>

        {/* Carte flottante */}
        <main className="px-6 -mt-10 relative z-20 flex-1 space-y-5 pb-6">
          <CardPagne stitch className="p-5">
            <div className="flex items-center justify-between">
              <h2 className="font-display font-extrabold text-[15px] text-sante-800">Prochain rendez-vous</h2>
              <Badge variant="normal">CONFIRMÉ</Badge>
            </div>
            <Nkyinkyim className="my-3" />
            <p className="text-sm text-stone-600">
              Dr Awa Koffi — <span className="font-bold">Cardiologie</span>
            </p>
            <p className="text-[13px] text-stone-500">Demain, 10:30 · Téléconsultation</p>
            <div className="mt-4 flex gap-2">
              <Button variant="sante" full>
                Rejoindre
              </Button>
              <Button variant="outline">Détails</Button>
            </div>
          </CardPagne>

          <section>
            <div className="flex items-center gap-2 mb-2">
              <Nkyinkyim className="flex-1 opacity-50" />
              <h3 className="font-display font-extrabold text-[12px] text-stone-500 uppercase tracking-wide">Composants</h3>
              <Nkyinkyim className="flex-1 opacity-50" />
            </div>

            <CardPagne className="p-4 space-y-3">
              <div className="flex flex-wrap gap-2">
                <Badge variant="normal">NORMAL</Badge>
                <Badge variant="eleve">ÉLEVÉ ▲</Badge>
                <Badge variant="priorite">PRIORITÉ</Badge>
                <Badge variant="pro">PRO</Badge>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="terre">Terre</Button>
                <Button variant="indigo">Indigo</Button>
                <Button variant="ocre">Or</Button>
                <Button variant="sos">SOS</Button>
              </div>
            </CardPagne>
          </section>
        </main>

        <BottomNav />
      </div>
    </div>
  );
}
