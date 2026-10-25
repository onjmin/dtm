/**
 * 自動作曲の曲名の候補（岩石・鉱物・鉱石の英名）。strata-compose.ts が --title を省いたときに使う。
 *
 * 2号兄貴の「鉱石シリーズ」と同じ名前・それを含む名前（Quartzite・Chalcopyrite など）は外す。
 * 実在の曲と取り違えないため。シリーズが増えたら REAL_TITLES に足す。
 */

/** 2号兄貴の実在曲（鉱石シリーズ）。この語を含む候補は使わない */
const REAL_TITLES = [
	"cobalt",
	"basalt",
	"andesite",
	"malachite",
	"granite",
	"amber",
	"peridotite",
	"sanukite",
	"quartz",
	"pyrite",
	"azurite",
];

// 火成岩
const IGNEOUS = `Adakite Anorthosite Aplite Basanite Benmoreite Boninite Camptonite Carbonatite
Charnockite Comendite Dacite Diabase Diorite Dolerite Dunite Essexite Gabbro Granodiorite
Granophyre Harzburgite Hawaiite Hornblendite Icelandite Ignimbrite Ijolite Kenyte Kersantite
Kimberlite Komatiite Lamproite Lamprophyre Larvikite Latite Leucitite Lherzolite Melilitite
Minette Monchiquite Monzonite Mugearite Nephelinite Norite Obsidian Pantellerite Pegmatite
Perlite Phonolite Picrite Pitchstone Porphyry Pumice Pyroxenite Rapakivi Rhyolite Scoria
Shonkinite Shoshonite Spessartite Syenite Tachylyte Tephrite Tonalite Trachyte Troctolite
Trondhjemite Tuff Unakite Variolite Vogesite Websterite Wehrlite`;

// 堆積岩
const SEDIMENTARY = `Anthracite Arenite Argillite Arkose Bauxite Breccia Calcarenite Caliche Chalk
Chert Claystone Conglomerate Coquina Diatomite Dolostone Evaporite Flint Geyserite Greywacke
Ironstone Laterite Lignite Limestone Loess Marl Mudstone Novaculite Oolite Phosphorite
Porcellanite Radiolarite Sandstone Shale Siltstone Tillite Travertine Tufa Turbidite Wacke`;

// 変成岩
const METAMORPHIC = `Amphibolite Blueschist Cataclasite Eclogite Gneiss Granulite Greenschist
Greenstone Hornfels Itacolumite Jadeitite Listvenite Marble Migmatite Mylonite Phyllite
Pseudotachylyte Rodingite Schist Serpentinite Skarn Slate Soapstone Spilite Tactite Whiteschist`;

// 鉱石（金属を取る鉱物）
const ORE = `Acanthite Anglesite Argentite Arsenopyrite Atacamite Bismuthinite Bornite Boulangerite
Bournonite Braunite Brochantite Calaverite Carnotite Cassiterite Cerussite Chalcocite
Chalcopyrite Chromite Chrysocolla Cinnabar Cobaltite Coffinite Columbite Covellite Crocoite
Cuprite Enargite Franklinite Galena Goethite Hausmannite Hematite Hemimorphite Ilmenite
Jamesonite Krennerite Limonite Linarite Magnetite Manganite Marcasite Millerite Mimetite
Molybdenite Monazite Nickeline Orpiment Pentlandite Petzite Pitchblende Polybasite Proustite
Psilomelane Pyrargyrite Pyrochlore Pyrolusite Pyromorphite Pyrrhotite Realgar Rhodochrosite
Rutile Scheelite Siderite Skutterudite Smithsonite Sphalerite Stibnite Sylvanite Tantalite
Tennantite Tenorite Tetrahedrite Thorianite Torbernite Uraninite Vanadinite Willemite
Wolframite Wulfenite Xenotime Zincite`;

// 鉱物・宝石
const MINERAL = `Actinolite Aegirine Agate Albite Alexandrite Allanite Almandine Amazonite
Amblygonite Analcime Andalusite Andradite Anhydrite Ankerite Anorthite Apatite Aquamarine
Aragonite Augite Autunite Aventurine Axinite Baddeleyite Barite Benitoite Beryl Biotite Borax
Cancrinite Carnallite Carnelian Celestine Chabazite Chalcedony Charoite Chlorite Chrysoberyl
Clinozoisite Colemanite Cordierite Corundum Cryolite Datolite Diamond Diopside Dioptase
Dolomite Dravite Elbaite Emerald Enstatite Epidote Fayalite Fluorite Forsterite Garnet
Glaucophane Graphite Grossular Gypsum Halite Hauyne Heliodor Heulandite Hiddenite Hornblende
Jadeite Jet Kaolinite Kernite Kunzite Kutnohorite Kyanite Labradorite Lazurite Lepidolite
Leucite Magnesite Microcline Moldavite Montmorillonite Moonstone Morganite Muscovite Natrolite
Nepheline Neptunite Oligoclase Olivine Onyx Opal Orthoclase Petalite Phlogopite Pollucite
Prehnite Pyrope Rhodonite Riebeckite Ruby Sanidine Sapphire Schorl Sillimanite Sodalite
Spessartine Spinel Spodumene Staurolite Stilbite Strontianite Sugilite Sunstone Sylvite Talc
Tanzanite Titanite Topaz Tourmaline Tremolite Tsavorite Turquoise Ulexite Uvarovite Variscite
Vesuvianite Wavellite Witherite Zircon Zoisite`;

export const ORE_NAMES: readonly string[] = [
	...new Set(
		[IGNEOUS, SEDIMENTARY, METAMORPHIC, ORE, MINERAL]
			.join(" ")
			.split(/\s+/)
			.filter(Boolean),
	),
].filter((n) => !REAL_TITLES.some((r) => n.toLowerCase().includes(r)));

/** 棚のフォルダ名（"… - <曲名>" か "… <曲名>"）でまだ使っていない候補から1つ選ぶ。使い切ったら重複を許す */
export const pickOreName = (shelfDirs: readonly string[]): string => {
	const left = ORE_NAMES.filter(
		(n) => !shelfDirs.some((d) => d.endsWith(` ${n}`)),
	);
	const pool = left.length ? left : ORE_NAMES;
	return pool[Math.floor(Math.random() * pool.length)] as string;
};
