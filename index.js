/* Copyright (c) 2006-2012 by OpenLayers Contributors (see authors.txt for 
 * full list of contributors). Published under the 2-clause BSD license.
 * See license.txt in the OpenLayers distribution or repository for the
 * full text of the license. */

/**
 * @requires OpenLayers.Format.OSM
 */

var pbf = require('osm-pbf');

//
// OpenLayers patches to support XMLHttpRequest 2 'arraybuffer' responseType
//
 
var xhrSendOrig = OpenLayers.Request.XMLHttpRequest.prototype.send;
OpenLayers.Request.XMLHttpRequest.prototype.send = function(vData) {
   this._object.responseType = 'arraybuffer';
   xhrSendOrig.apply(this, arguments);
};

var httpParseFeaturesOrig = OpenLayers.Protocol.HTTP.prototype.parseFeatures;
OpenLayers.Protocol.HTTP.prototype.parseFeatures = function(request) {
    if (!request._object.response) {
        return httpParseFeaturesOrig.apply(this, arguments);
    } else {
        return this.format.read(request._object.response);
    }
};

var httpHandleResponseOrig = OpenLayers.Protocol.HTTP.prototype.handleResponse;
OpenLayers.Protocol.HTTP.prototype.handleResponse = function(resp, options) {
  // local files (file:/// URL) may return response status 0
  if (resp.priv.status === 0) {
      resp.priv.status = 200;
      resp.priv._object.status = 200;
  }
  httpHandleResponseOrig.apply(this, arguments);
};

//
// OpenLayers patches for performance optimization (no string parsing, already got number)
//

// replacing initialize seems not to work?
//OpenLayers.Geometry.Point.prototype.initialize = function(x, y) {
OpenLayers.Geometry.PbfPoint = OpenLayers.Class(OpenLayers.Geometry.Point, {
    initialize: function(x, y) {
        // replaces OpenLayers.Geometry.Point initialize > skip

        // optimize OpenLayers.Geometry initialize > skip
        OpenLayers.Util.lastSeqID += 1; 
        this.id = "OpenLayers_Geometry_Point_" + OpenLayers.Util.lastSeqID;        
    
        // assume both of same type for better performance
        if (typeof x === 'number') {
            this.x = x;
            this.y = y;
        } else {
            this.x = parseFloat(x);
            this.y = parseFloat(y);
        }
    }
});

//OpenLayers.Geometry.OsmPoint = OpenLayers.Class(OpenLayers.Geometry.Point, {
//osm_id: null
//});



/**
 * Class: OpenLayers.Format.PBF
 *
 * Simple support to read the binary OSM PBF format.
 *
 * NOTE: EXPERIMENTAL!
 *
 * Inherits from:
 *  - <OpenLayers.Format>
 */
OpenLayers.Format.PBF = OpenLayers.Class(OpenLayers.Format.OSM, { //OpenLayers.Format, {

    //checkTags: false,

    initialize: function(options) {
        options = options || {};

        // OSM coordinates are always in longlat WGS84
        //this.externalProjection = new OpenLayers.Projection("EPSG:4326");

        //OpenLayers.Format.prototype.initialize.apply(this, arguments);
        OpenLayers.Format.OSM.prototype.initialize.apply(this, arguments);
    }, 
    
    //read: function(text) {
    read: function(buffer) {
    
        //console.time("PBF.getEntities");
//        console.profile('PBF.getEntities');
        var entities = this.getEntities(buffer);
//        console.profileEnd();
        var nodes = entities.nodes;
        var ways = entities.ways;
        //console.timeEnd("PBF.getEntities");

        var feat_list = [];

//        console.time("PBF ways");
        for (var i = 0; i < ways.length; i++) {
            // We know the minimal of this one ahead of time. (Could be -1
            // due to areas/polygons)
            var numNodes = ways[i].refs.length;
            var point_list = [];
            
            //timer.start("PBF ways.refs");
            for (var j = 0; j < numNodes; j++) {
               var nodeId = ways[i].refs[j];
               var node = nodes[nodeId];
               
               if (node) {
                   var point = new OpenLayers.Geometry.PbfPoint(node.lon, node.lat);
                   
                   // Since OSM is topological, we stash the node ID internally. 
                   point.osm_id = nodeId;
                   point_list.push(point);
                   
                   // We don't display nodes if they're used inside other 
                   // elements.
                   node.used = true;
               } else {
                   //console.warn('node ref not found: way=' + ways[i].id + ', ref=' + nodeId);
               }
            }
            // discard incomplete ways
            if (point_list.length < numNodes) {
                //console.warn('discarding way ' + ways[i].id + ' because of missing nodes (' + point_list.length + '/' + numNodes + ')');
                continue;
            }
            
            //timer.stop("PBF ways.refs");
            //timer.start("PBF ways geometry");
            var geometry = null;
            var poly = this.isWayArea(ways[i]) ? 1 : 0; 
            if (poly) { 
                geometry = new OpenLayers.Geometry.Polygon(
                    new OpenLayers.Geometry.LinearRing(point_list));
            } else {    
                geometry = new OpenLayers.Geometry.LineString(point_list);
            }
            //timer.stop("PBF ways geometry");
            //timer.start("PBF ways transform");
            if (this.internalProjection && this.externalProjection) {
                geometry.transform(this.externalProjection, 
                    this.internalProjection);
            }        
            //timer.stop("PBF ways transform");
            //timer.start("PBF ways Vector");
            var feat = new OpenLayers.Feature.Vector(geometry,
                ways[i].keysvals);
            //timer.stop("PBF ways Vector");
            //timer.start("PBF ways Vector props");
            feat.osm_id = ways[i].id;
            feat.fid = "way." + feat.osm_id;
            feat_list.push(feat);
            //timer.stop("PBF ways Vector props");
        }         
//        console.timeEnd("PBF ways");
        //console.time("PBF nodes");
        for (var node_id in nodes) {
            var node = nodes[node_id];
            if (!node.used || this.checkTags) {
                var tags = null;

                if (this.checkTags) {
                    var result = this.getTags(node, true);
                    if (node.used && !result[1]) {
                        continue;
                    }
                    tags = result[0];
                } else { 
                    tags = node.keyval;
                } 
                
                var feat = new OpenLayers.Feature.Vector(
                    new OpenLayers.Geometry.PbfPoint(node['lon'], node['lat']),
                    tags);
                if (this.internalProjection && this.externalProjection) {
                    feat.geometry.transform(this.externalProjection, 
                        this.internalProjection);
                }        
                feat.osm_id = node_id; 
                feat.fid = "node." + feat.osm_id;
                feat_list.push(feat);
            }   
        }        
        //console.timeEnd("PBF nodes");
        return feat_list;
    },

    getEntities: function(buffer) {
        var fileblockfile = new pbf.BufferBlockFile(buffer);
        var pbffile = new pbf.OnePassPBFFile(fileblockfile);

        var nodes = {};
        var ways = [];
        pbffile.read(function(node) {
                nodes[node.id] = node;
             }, function(pbfWay) {
                // because of OSM.isWayArea
                pbfWay.nodes = pbfWay.refs;
                ways.push(pbfWay);
            }, function() {
                // finish, ignore
                //console.log('onfinish');
        });
        //console.log('getEntities end');
        return {nodes: nodes, ways: ways};
    },

    getTags: function(node, interesting_tags) {
        var tag_list = node.keyval;
        var tags = {};
        var interesting = false;
        for (var key in tag_list) {
            tags[key] = tag_list[key];
            if (interesting_tags) {
                if (!this.interestingTagsExclude[key]) {
                    interesting = true;
                }
            }    
        }  
        return interesting_tags ? [tags, interesting] : tags;     
    },

    //isWayArea: OpenLayers.Format.OSM.prototype.isWayArea,
    
    CLASS_NAME: "OpenLayers.Format.PBF" 
});    
    