// Point d'entrée Vercel : toutes les requêtes /api/* sont réécrites vers cette fonction
// (voir vercel.json), qui délègue à l'application Express.
import app from '../server/app.js'

export default app
