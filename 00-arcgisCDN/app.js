const Graphic = await $arcgis.import("@arcgis/core/Graphic.js");
const viewElement = document.querySelector("arcgis-map");

// Wait for the view to be ready
await viewElement.when();

// ...

// You can now add graphics or other layers to the view
// Create a graphic and add the geometry and symbol to it
const pointGraphic = new Graphic(
    {
        geometry: point, // A point geometry
        symbol: markerSymbol, // A symbol for drawing the point

        // geometry: {
        //     type: "point",
        //     longitude: -118.15,
        //     latitude: 33.8
        // },
        // symbol: {
        //     type: "simple-marker",
        //     color: "red",
        //     size: "5000px"
        // }
}
);
viewElement.graphics.add(pointGraphic);