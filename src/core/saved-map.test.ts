import {
  SAVED_MAP_VERSION,
  SavedMapValidationError,
  parseSavedMapState,
  type SavedMapState,
} from "./saved-map";

function validState(): SavedMapState {
  return {
    version: SAVED_MAP_VERSION,
    startingLocation: { longitude: -84.388, latitude: 33.749 },
    filters: [
      {
        instanceId: "filter-1",
        contribution: "nearby-parks/distance",
        parameters: { distance: 750 },
        enabled: false,
        randomSeed: 123,
      },
    ],
    heatmaps: [],
  };
}

describe("saved map state", () => {
  it("accepts versioned locations, parameters, and enabled states", () => {
    expect(parseSavedMapState(validState())).toEqual(validState());
  });

  it("rejects invalid coordinates and duplicate instance IDs", () => {
    expect(() =>
      parseSavedMapState({
        ...validState(),
        startingLocation: { longitude: 181, latitude: 33.749 },
      }),
    ).toThrow(SavedMapValidationError);

    expect(() =>
      parseSavedMapState({
        ...validState(),
        heatmaps: [
          {
            instanceId: "filter-1",
            contribution: "nearby-parks/influence",
            parameters: {},
            enabled: true,
            randomSeed: 456,
          },
        ],
      }),
    ).toThrow("Duplicate saved instance ID");
  });
});
