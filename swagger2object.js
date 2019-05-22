// Ported from https://github.com/swagger-api/swagger-ui (Apache License, Version 2.0)
//     see: https://github.com/swagger-api/swagger-ui/blob/master/src/core/plugins/samples/fn.js
//        & https://github.com/swagger-api/swagger-ui/blob/master/src/core/utils.js
//
// TODO: fix missing immutable import (currently just returns false for isImmutable)

//Im = require("immutable")

const stringCollection = {
    ref: "#/definitions/Collection«string»",
    schema: {
        "type": "array",
        "items": {
            "type": "string"
        }
    }
}

const primitives = {
    "string": () => "string",
    "string_email": () => "user@example.com",
    "string_date-time": () => new Date().toISOString(),
    "number": () => 0,
    "number_float": () => 0.0,
    "integer": () => 0,
    "boolean": (schema) => typeof schema.default === "boolean" ? schema.default : true
}

const primitive = (schema) => {
    schema = objectify(schema);
    let { type, format } = schema;

    let fn = primitives[`${type}_${format}`] || primitives[type];

    if (isFunc(fn)) {
        return fn(schema);
    }

    return `Unknown Type: ${schema.type}`;
}

const isFunc = (thing) => typeof (thing) === "function"

const isImmutable = (maybe) => false //Im.Iterable.isIterable(maybe)

const isObject = (obj) => !!obj && typeof obj === "object"

const getRef = (obj) => isObject(obj) ? obj.$ref : undefined

const isRef = (obj) => getRef(obj)

const normalizeArray = (arr) => Array.isArray(arr) ? arr : [arr];

function objectify(thing) {
    if (!isObject(thing)) {
        return {};
    }

    if (isImmutable(thing)) {
        return thing.toObject();
    }

    return thing;
}

function resolveRef(refObj, refsLookup) {
    var ref = getRef(refObj);

    if (ref === stringCollection.ref) {
        return stringCollection.schema;
    } else {
        var schema = refsLookup[ref];
        return schema;
    }
}

function genSchemaObject(schema, refsLookup, config = {}, fieldName = null, parentSchema = null, swaggerPath = null) {
    if (isRef(schema)) {
        var ref = schema.$ref;
        schema = resolveRef(schema, refsLookup);
        schema._$ref = ref;
    }

    let { type, example, properties, additionalProperties, items } = objectify(schema);
    let { includeReadOnly, includeWriteOnly } = config;

    if (example !== undefined) {
        return example;
    }

    if (!type) {
        if (properties) {
            type = "object";
        } else if (items) {
            type = "array";
        } else {
            return;
        }
    }

    if (type === "file") {
        return;
    }

    if (type === "object") {
        let props = objectify(properties);
        let obj = {};

        for (var name in props) {
            if (props[name].readOnly && !includeReadOnly) {
                continue;
            }

            if (props[name].writeOnly && !includeWriteOnly) {
                continue;
            }

            if (isRef(props[name])) {
                props[name] = resolveRef(props[name], refsLookup);
            }

            obj[name] = genSchemaObject(props[name], refsLookup, config, name, schema, swaggerPath);
        }

        if (additionalProperties === true) {
            obj.additionalProp1 = {};
        } else if (additionalProperties) {
            let additionalProps = objectify(additionalProperties);
            let additionalPropVal = genSchemaObject(additionalProps, refsLookup, config, fieldName, schema, swaggerPath);

            for (let i = 1; i < 4; i++) {
                obj[`additionalProp${i}`] = additionalPropVal;
            }
        }
        return obj;
    }

    if (type === "array") {
        if (isRef(items)) {
            items = resolveRef(items, refsLookup);
        }

        return [genSchemaObject(items, refsLookup, config, fieldName, schema, swaggerPath)];
    }

    var value;

    if (schema["enum"]) {
        if (schema["default"]) {
            value = schema["default"];
        } else {
            var enumValues = normalizeArray(schema["enum"]).map((v) => v.toLowerCase());

            // educated guess based on parent schema reference
            if (parentSchema && parentSchema._$ref) {
                var parentRef = parentSchema._$ref.toLowerCase();
                value = enumValues.find((v) => parentRef.includes(v));
            }

            // educated guess based on swagger path description
            if (!value && swaggerPath && swaggerPath.description) {
                var swaggerPath = 
                    swaggerPath.description ? swaggerPath.description.toLowerCase() : "";

                value = enumValues.find((v) => swaggerPath.includes(v));
            }

            if (value) {
                return value;
            }

            value = enumValues[0];
        }
    }

    if (!value) {
        value = primitive(schema);
    }

    if (fieldName && value === primitives.string() ) {
        value = fieldName;
    }

    if (typeof value === "string") {
        // value = value.toLowerCase();
        value = '{{' + value + '}}';
    }

    return value;
}

function getRefForSchema (schema, unknownTypeCounter) {
    if (schema.$ref) {
        return schema.$ref;
    } else if (isObject(schema.items) && schema.items.$ref) {
        return schema.items.$ref;
    } else {
        return `unknown_type_${unknownTypeCounter}`;
    }
}

function genSpecResponseObjects (swaggerSpec, options) {
    var refsLookup = buildSwaggerRefsLookup(swaggerSpec, options);
    var specResponses = {};
    var unknownTypeCounter = 0;
    var includeUnknownTypes = options && options.includeUnknownTypes;

    var paths = swaggerSpec.paths;

    for (var key in paths) {
        if (!paths.hasOwnProperty(key)) {
            continue;
        }

        var pathRoot = paths[key];

        for (var pathKey in pathRoot) {
            if (!pathRoot.hasOwnProperty(pathKey)) {
                continue;
            }

            var responses = pathRoot[pathKey].responses;

            if (!responses) {
                continue;
            }

            for (var responseKey in responses) {
                if (!responses.hasOwnProperty(responseKey)) {
                    continue;
                }
            
                var response = responses[responseKey];
                var schema = response.schema;

                if (!schema) {
                    continue;
                }

                var obj = genSchemaObject(response.schema, refsLookup);
                var ref = getRefForSchema(schema, unknownTypeCounter);
                
                if (!specResponses[ref]) {
                    if (ref.includes("unknown_type_")) {
                        unknownTypeCounter++;

                        if (!includeUnknownTypes) {
                            continue;
                        }
                    }

                    specResponses[ref] = obj;
                }
            }
        }
    }

    return specResponses;
}

function genSpecRequestObjects (swaggerSpec, options) {
    var refsLookup = buildSwaggerRefsLookup(swaggerSpec, options);
    var specRequests = {};
    var unknownTypeCounter = 0;
    var includeUnknownTypes = options && options.includeUnknownTypes;

    var paths = swaggerSpec.paths;

    for (var key in paths) {
        if (!paths.hasOwnProperty(key)) {
            continue;
        }

        var pathRoot = paths[key];

        for (var pathKey in pathRoot) {
            if (!pathRoot.hasOwnProperty(pathKey)) {
                continue;
            }

            var path = pathRoot[pathKey];
            let {parameter, obj} = genObjectForPathBody(path, refsLookup, options);

            if (!obj) {
                continue;
            }

            var schema = parameter.schema;
            var ref = getRefForSchema(schema, unknownTypeCounter);

            if (!specRequests[ref]) {
                if (ref.includes("unknown_type_")) {
                    unknownTypeCounter++;
                    
                    if (!includeUnknownTypes) {
                        continue;
                    }
                }

                specRequests[ref] = obj;
            }
        }
    }

    return specRequests;
}

function genSpecSchemaObjects (swaggerSpec, options) {
    var refsLookup = buildSwaggerRefsLookup(swaggerSpec, options);
    var specObjs = {};

    for (var key in refsLookup) {
        if (!refsLookup.hasOwnProperty(key)) {
            continue;
        }

        specObjs[key] = genSchemaObject(refsLookup[key], refsLookup);
    }

    return specObjs;
}

function genObjectForPathBody (swaggerPath, swaggerRefsLookup, options) {
    var result = {
        parameter: undefined,
        obj: undefined
    };

    if (!swaggerPath.parameters || 
        (swaggerPath.parameters.length < 1)) {
            return result;
    }

    swaggerPath.parameters.forEach((p) => {
        if (result.obj || !p.in || p.in !== "body") {
            return;
        }

        try {
            result.obj = genSchemaObject(p.schema, swaggerRefsLookup, {}, null, null, swaggerPath);
            result.parameter = p;
        } catch (e) {
            sampleObj = undefined;

            if (options && options.debug) {
                console.log(`Error generating sample from schema: ${JSON.stringify(p.schema)}`);
                console.log(e);
            }
        }
    });

    return result;
}

function buildSwaggerRefsLookup(swaggerSpec, options) {
    var refsLookup = {};
    var refCount = 0;

    if (options && options.debug) {
        console.log(`Building refs lookup for Swagger spec '${swaggerSpec.info.title}'...`);
    }

    for (var key in swaggerSpec.definitions) {
        if (swaggerSpec.definitions.hasOwnProperty(key)) {
            ref = `#/definitions/${key}`;
            schema = swaggerSpec.definitions[key];

            if (options && options.debug) {
                console.log(`Schmea for ref '${ref}': `);
                console.log(`${JSON.stringify(schema, null, 4)}`);
            }

            refsLookup[ref] = schema;
            refCount++;
        }
    }

    if (options && options.debug) {
        if (refCount > 0) {
            console.log(`Found ${refCount} schema definitions in Swagger spec`)
        } else {
            console.log(`Swagger spec contained no schema definitions`)
        }
    }

    return refsLookup;
}

module.exports = {
    buildRefsLookup: () => ({
        forSpec: buildSwaggerRefsLookup
    }),
    generateObjects: () => ({
        for: () => ({
            specSchemas: (spec, options) => genSpecSchemaObjects(spec, options),
            specRequests: (spec, options) => genSpecRequestObjects(spec, options),
            specResponses: (spec, options) => genSpecResponseObjects(spec, options)
        })
    }),
    generateObject: () => ({
        for: () => ({
            pathBodyUsingRefs: (path, refs, options) => (genObjectForPathBody(path, refs, options)).obj,
            schemaUsingRefs: genSchemaObject,
            schemaUsingSpec: (schema, spec, options) =>
                genSchemaObject(schema, buildSwaggerRefsLookup(spec, options))
        })
    })
}
