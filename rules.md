vanila js, client side only. So server. No Es6 modules
Anotate code. Don't double up on functions, try to channel flow though one path when possible.
Put classes in separate files



make a riffs selector drop down from the data>riffs file
riff.notes is a string of coordinates.

A recorded riff may also include an `events` array containing objects with exact playback data. Each event looks like `{ xCw: <cell>, yCw: <cell>, timeMs: <milliseconds> }` allowing MIDI‑style timing and direct world coordinates.
designated as follows
(y=direction in fret space relative to root of current chord not key, x=frets up or down per beat 1 2 3 4)
+ve y and x means up in tone in fret space
playback plays the selected riff with dots on screen as usual. Dots and tones
should be made is fretspace even if a brick is not present



