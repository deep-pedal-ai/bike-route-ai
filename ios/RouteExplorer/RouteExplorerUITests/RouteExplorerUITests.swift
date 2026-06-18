import XCTest

final class RouteExplorerUITests: XCTestCase {
    func testLaunchShowsMapSearchAndFilters() {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-test-fixtures"]
        app.launch()

        XCTAssertTrue(app.otherElements["route-map"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.textFields["Route search"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["Source filter"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["Facility overlay"].exists)
    }

    func testSearchResultSelectionDetailsAndCloseSearch() {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-test-fixtures"]
        app.launch()

        let searchField = app.textFields["Route search"]
        XCTAssertTrue(searchField.waitForExistence(timeout: 5))
        searchField.tap()
        searchField.typeText("harbor loop")
        app.buttons["Search routes"].tap()

        XCTAssertTrue(app.staticTexts["1 result"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["search-result-4"].waitForExistence(timeout: 5))
        app.buttons["search-result-4"].tap()

        XCTAssertTrue(app.otherElements["route-detail-sheet"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Harbor Loop"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["Start in Apple Maps"].exists)
        XCTAssertTrue(app.staticTexts["Nearby"].exists)
        XCTAssertTrue(app.staticTexts["Balboa Coffee"].exists)
        XCTAssertTrue(app.staticTexts["Facility coverage"].exists)
        app.buttons["Close route details"].tap()

        XCTAssertTrue(app.buttons["close-search-results"].waitForExistence(timeout: 5))
        app.buttons["close-search-results"].tap()
        XCTAssertTrue(app.buttons["Source filter"].waitForExistence(timeout: 5))
    }
}
