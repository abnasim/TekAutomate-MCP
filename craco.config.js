module.exports = {
  jest: {
    configure: (jestConfig) => {
      jestConfig.reporters = [
        'default',
        [
          'jest-html-reporter',
          {
            outputPath: './test-report/' + (process.env.REPORT_FILENAME || 'report.html'),
            pageTitle: process.env.REPORT_FILENAME ? 'TekAutomate SCPI Validation Report' : 'TekAutomate Test Report',
            includeFailureMsg: true,
            includeSuiteFailure: true,
            theme: 'darkTheme',
          },
        ],
      ];
      return jestConfig;
    },
  },
  webpack: {
    configure: (webpackConfig) => {
      const path = require('path');
      const vendorNoVncPath = path.resolve(__dirname, 'src/vendor/novnc');

      // Suppress source map warnings by ignoring errors from source-map-loader
      const originalIgnoreWarnings = webpackConfig.ignoreWarnings || [];
      
      webpackConfig.ignoreWarnings = [
        ...originalIgnoreWarnings,
        // Ignore all source map warnings
        /Failed to parse source map/,
        /ENOENT.*source-map/,
        /blockly/,
      ];
      
      // Function to recursively find and modify source-map-loader
      const modifySourceMapLoader = (rules) => {
        if (!Array.isArray(rules)) return;
        
        rules.forEach((rule) => {
          // Check if this rule uses source-map-loader
          if (rule.use && Array.isArray(rule.use)) {
            const hasSourceMapLoader = rule.use.some(
              (use) => typeof use === 'object' && use.loader && use.loader.includes('source-map-loader')
            );
            
            if (hasSourceMapLoader) {
              // Exclude node_modules from this rule
              rule.exclude = rule.exclude 
                ? Array.isArray(rule.exclude) 
                  ? [...rule.exclude, /node_modules/]
                  : [rule.exclude, /node_modules/]
                : /node_modules/;
            }
          }
          
          // Check if rule.loader is source-map-loader
          if (rule.loader && rule.loader.includes('source-map-loader')) {
            rule.exclude = rule.exclude 
              ? Array.isArray(rule.exclude) 
                ? [...rule.exclude, /node_modules/]
                : [rule.exclude, /node_modules/]
              : /node_modules/;
          }
          
          // Handle oneOf rules (CRA structure)
          if (rule.oneOf && Array.isArray(rule.oneOf)) {
            modifySourceMapLoader(rule.oneOf);
          }
        });
      };
      
      // Process all rules
      if (webpackConfig.module && webpackConfig.module.rules) {
        modifySourceMapLoader(webpackConfig.module.rules);
      }

      // Remove ReactRefreshWebpackPlugin and react-refresh/babel in production
      if (process.env.NODE_ENV === 'production' && Array.isArray(webpackConfig.plugins)) {
        webpackConfig.plugins = webpackConfig.plugins.filter(
          (plugin) => !plugin || !plugin.constructor || plugin.constructor.name !== 'ReactRefreshWebpackPlugin'
        );
      }

      // Strip react-refresh/babel from babel-loader in production
      if (process.env.NODE_ENV === 'production' && webpackConfig.module && webpackConfig.module.rules) {
        const stripReactRefreshFromRules = (rules) => {
          if (!Array.isArray(rules)) return;
          rules.forEach((rule) => {
            if (rule.use && Array.isArray(rule.use)) {
              rule.use.forEach((use) => {
                if (use && use.options && use.options.plugins) {
                  use.options.plugins = use.options.plugins.filter(
                    (p) => !String(typeof p === 'string' ? p : Array.isArray(p) ? p[0] : '').includes('react-refresh')
                  );
                }
              });
            }
            if (rule.options && rule.options.plugins) {
              rule.options.plugins = rule.options.plugins.filter(
                (p) => !String(typeof p === 'string' ? p : Array.isArray(p) ? p[0] : '').includes('react-refresh')
              );
            }
            if (rule.oneOf) stripReactRefreshFromRules(rule.oneOf);
          });
        };
        stripReactRefreshFromRules(webpackConfig.module.rules);
      }

      if (Array.isArray(webpackConfig.plugins)) {
        webpackConfig.plugins.forEach((plugin) => {
          if (plugin && plugin.constructor && plugin.constructor.name === 'ESLintWebpackPlugin') {
            const existingExclude = plugin.options.exclude;
            if (!existingExclude) {
              plugin.options.exclude = [vendorNoVncPath];
            } else if (Array.isArray(existingExclude)) {
              plugin.options.exclude = [...existingExclude, vendorNoVncPath];
            } else {
              plugin.options.exclude = [existingExclude, vendorNoVncPath];
            }
          }
        });
      }
      
      return webpackConfig;
    },
  },
};
