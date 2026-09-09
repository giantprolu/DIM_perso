/**
 * Pictogramme RPG Awesome.
 *
 * La police ne porte aucun sens pour un lecteur d'écran : l'icône est donc
 * toujours décorative, et le texte qui l'accompagne doit se suffire à lui-même.
 */
export default function RaIcon({
  icon,
  className = "",
  title,
}: {
  /** Nom de la classe, par exemple « ra-dragon ». */
  icon: string;
  className?: string;
  title?: string;
}) {
  return (
    <i
      className={`ra ${icon} ${className}`.trim()}
      aria-hidden="true"
      title={title}
    />
  );
}
