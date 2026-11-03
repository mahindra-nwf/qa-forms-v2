# qa-forms-v2

Plant QA log sheets, rebuilt from a blank start and grown part by part. The previous app, with its full history, is in `E:\QA forms-v1` (GitHub: mahindra-nwf/qa-forms).

## Run it

```
node server.js
```

Then open http://localhost:8080. Nothing to install.

## Folders

- `products/<Brand>/<Product>/`: one folder per product. `product.json` holds its name, pack size, item number and display order; every other `.json` file in the folder is a log sheet for that product.
- `plant/`: plant-wide log sheets that aren't tied to one product (SSOP, receiving, shipping).
- `forms/samples/`: the library of log sheets. "Add log sheet" in the app copies one from here into a folder.
- `docs/`: the earlier build plan and mockups, for reference.
