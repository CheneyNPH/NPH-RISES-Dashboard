// The slice of the Office Scripts ExcelScript API that BuildSageOEImport.ts uses,
// with the same signatures as Excel for the web, so tsc can type-check it offline.
declare namespace ExcelScript {
  interface Workbook {
    getWorksheet(name: string): Worksheet | undefined;
    getWorksheets(): Worksheet[];
    addWorksheet(name?: string): Worksheet;
  }
  interface Worksheet {
    getName(): string;
    setPosition(position: number): void;
    delete(): void;
    getRange(address?: string): Range;
    getRangeByIndexes(startRow: number, startColumn: number, rowCount: number, columnCount: number): Range;
  }
  interface Range {
    clear(): void;
    setValues(values: (string | number | boolean)[][]): void;
    setNumberFormatLocal(numberFormatLocal: string): void;
    getFormat(): RangeFormat;
  }
  interface RangeFormat {
    autofitColumns(): void;
    getFont(): RangeFont;
  }
  interface RangeFont {
    setBold(bold: boolean): void;
  }
}
